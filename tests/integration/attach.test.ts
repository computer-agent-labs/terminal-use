import {createConnection, type Socket} from 'node:net'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {afterEach, describe, expect, it} from 'vitest'

import {AttachServer} from '../../src/attach/AttachServer.js'
import {
  encodeData,
  encodeDetach,
  encodeResize,
  FRAME_DATA,
  FrameDecoder,
  type Frame
} from '../../src/attach/framing.js'
import {TerminalSession} from '../../src/session/TerminalSession.js'

interface ClientHandle {
  socket: Socket
  frames: Frame[]
  text: () => string
  close: () => void
}

function tmpSocketPath(label: string): string {
  return join(tmpdir(), `terminal-use-test-${process.pid}-${label}-${Date.now()}.sock`)
}

function waitMs(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

function connectClient(socketPath: string): Promise<ClientHandle> {
  return new Promise((resolve, reject) => {
    const decoder = new FrameDecoder()
    const frames: Frame[] = []
    const socket = createConnection(socketPath, () => {
      resolve({
        socket,
        frames,
        text: () =>
          frames
            .filter(f => f.type === FRAME_DATA)
            .map(f => f.payload.toString('utf8'))
            .join(''),
        close: () => socket.destroy()
      })
    })
    socket.on('data', chunk => {
      for (const f of decoder.push(chunk)) frames.push(f)
    })
    socket.on('error', err => reject(err))
  })
}

const cleanups: Array<() => void | Promise<void>> = []

afterEach(async () => {
  while (cleanups.length > 0) {
    try {
      await cleanups.pop()!()
    } catch {
      // ignore
    }
  }
})

function makeServerSession(): {server: AttachServer; session: TerminalSession; unsub: () => void} {
  const socketPath = tmpSocketPath(`s-${Math.random().toString(36).slice(2, 8)}`)
  const session = new TerminalSession({
    shell: '/bin/sh',
    cwd: process.cwd(),
    cols: 80,
    rows: 24
  })
  const server = new AttachServer(socketPath)
  server.setTarget(session)
  const unsub = session.onData(chunk => server.broadcast(chunk))
  cleanups.push(() => {
    try {
      unsub()
    } catch {
      // ignore
    }
    server.close()
    session.dispose()
  })
  return {server, session, unsub}
}

describe('AttachServer over a Unix socket', () => {
  it('forwards DATA frames from a connected client into the PTY', async () => {
    const {server} = makeServerSession()
    const c = await connectClient(server.socketPath)
    cleanups.push(() => c.close())
    // Give the shell a tick to settle past startup output.
    await waitMs(150)
    c.socket.write(encodeData('echo from-client\n'))
    // Wait long enough for the shell to echo + run + reply.
    await waitMs(500)
    const seen = c.text()
    expect(seen).toMatch(/from-client/)
  })

  it('broadcasts PTY output to every attached client', async () => {
    const {server, session} = makeServerSession()
    const c1 = await connectClient(server.socketPath)
    cleanups.push(() => c1.close())
    const c2 = await connectClient(server.socketPath)
    cleanups.push(() => c2.close())
    await waitMs(100)
    session.pty.write('echo broadcast-marker\n')
    await waitMs(500)
    expect(c1.text()).toMatch(/broadcast-marker/)
    expect(c2.text()).toMatch(/broadcast-marker/)
  })

  it('handles client disconnect cleanly without affecting the session', async () => {
    const {server, session} = makeServerSession()
    const c = await connectClient(server.socketPath)
    expect(server.clientCount).toBe(1)
    c.close()
    await waitMs(100)
    expect(server.clientCount).toBe(0)
    // Session still works.
    session.pty.write('echo still-here\n')
    await waitMs(300)
    // Just confirming no crash; nothing to assert beyond surviving the disconnect.
    expect(session.isAlive).toBe(true)
  })

  it('forwards RESIZE frames into the bound session', async () => {
    const {server, session} = makeServerSession()
    const c = await connectClient(server.socketPath)
    cleanups.push(() => c.close())
    await waitMs(50)
    c.socket.write(encodeResize(100, 40))
    await waitMs(100)
    expect(session.term.cols).toBe(100)
    expect(session.term.rows).toBe(40)
    expect(session.pty.cols).toBe(100)
    expect(session.pty.rows).toBe(40)
  })

  it('DETACH frame from client closes the connection cleanly', async () => {
    const {server} = makeServerSession()
    const c = await connectClient(server.socketPath)
    expect(server.clientCount).toBe(1)
    c.socket.write(encodeDetach())
    await waitMs(100)
    expect(server.clientCount).toBe(0)
  })

  it('setTarget(undefined) drops incoming client bytes without crashing', async () => {
    const {server} = makeServerSession()
    server.setTarget(undefined)
    const c = await connectClient(server.socketPath)
    cleanups.push(() => c.close())
    // Should not crash. Bytes are silently dropped.
    c.socket.write(encodeData('noop\n'))
    await waitMs(100)
    expect(server.clientCount).toBe(1) // still attached
  })

  it('rebinding setTarget to a new session swaps the destination', async () => {
    const socketPath = tmpSocketPath(`rebind-${Math.random().toString(36).slice(2, 8)}`)
    const sessionA = new TerminalSession({shell: '/bin/sh', cwd: process.cwd(), cols: 80, rows: 24})
    const server = new AttachServer(socketPath)
    server.setTarget(sessionA)
    const unsubA = sessionA.onData(chunk => server.broadcast(chunk))
    cleanups.push(() => {
      try {
        unsubA()
      } catch {
        // ignore
      }
      server.close()
      try {
        sessionA.dispose()
      } catch {
        // ignore
      }
    })

    const c = await connectClient(server.socketPath)
    cleanups.push(() => c.close())
    await waitMs(150)
    c.socket.write(encodeData('echo first-session\n'))
    await waitMs(400)
    expect(c.text()).toMatch(/first-session/)

    // Swap to a brand-new session (simulating respawn).
    unsubA()
    sessionA.dispose()
    const sessionB = new TerminalSession({shell: '/bin/sh', cwd: process.cwd(), cols: 80, rows: 24})
    server.setTarget(sessionB)
    const unsubB = sessionB.onData(chunk => server.broadcast(chunk))
    cleanups.push(() => {
      try {
        unsubB()
      } catch {
        // ignore
      }
      try {
        sessionB.dispose()
      } catch {
        // ignore
      }
    })
    await waitMs(150)

    c.socket.write(encodeData('echo second-session\n'))
    await waitMs(500)
    expect(c.text()).toMatch(/second-session/)
    // The client's connection was preserved across the swap.
    expect(server.clientCount).toBe(1)
  })
})
