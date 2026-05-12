import {chmodSync, existsSync, unlinkSync} from 'node:fs'
import {createServer, type Server, type Socket} from 'node:net'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import type {TerminalSession} from '../session/TerminalSession.js'

import {encodeData, FRAME_DATA, FRAME_DETACH, FRAME_RESIZE, FrameDecoder, parseResize} from './framing.js'

export function socketPathFor(serverPid: number, sessionId: number): string {
  return join(tmpdir(), `terminal-use-${serverPid}-${sessionId}.sock`)
}

interface ClientState {
  socket: Socket
  decoder: FrameDecoder
}

/**
 * Hosts a Unix domain socket for one terminal-use session. Multiplexes any
 * number of attached human clients onto a single underlying TerminalSession.
 *
 * Lifecycle:
 *   - `new AttachServer(socketPath)` creates and listens on the socket
 *     (mode 0600 — same Unix user only).
 *   - `setTarget(session)` binds the bytes flowing in/out to that session.
 *     Called once at create-time and again on respawn (so attached clients
 *     keep their connection across an under-the-hood pty replacement).
 *   - `close()` disconnects every client, stops listening, and unlinks the
 *     socket file.
 *
 * Each PTY chunk arriving at the bound session is forwarded by McpContext
 * (via the session's onData hook) into `broadcast()`. Each client's
 * incoming DATA bytes are written straight into `session.pty.write` —
 * same code path the agent uses, so the human and the agent are peers.
 */
export class AttachServer {
  #socketPath: string
  #server: Server
  #target: TerminalSession | undefined
  #clients = new Set<ClientState>()
  #closed = false

  constructor(socketPath: string) {
    this.#socketPath = socketPath
    // Best-effort: clean up any leftover socket file from a crashed
    // previous run before binding.
    if (existsSync(socketPath)) {
      try {
        unlinkSync(socketPath)
      } catch {
        // ignore — listen() will surface a clearer error
      }
    }
    this.#server = createServer(socket => this.#handleClient(socket))
    this.#server.listen(socketPath, () => {
      // listen() is async on Unix sockets; chmod after it binds.
      try {
        chmodSync(socketPath, 0o600)
      } catch {
        // Some filesystems / OS-es don't honor chmod on socket files; not fatal.
      }
    })
  }

  get socketPath(): string {
    return this.#socketPath
  }

  get clientCount(): number {
    return this.#clients.size
  }

  setTarget(session: TerminalSession | undefined): void {
    this.#target = session
  }

  /** Send a PTY-data chunk to every connected client. */
  broadcast(chunk: string | Uint8Array): void {
    if (this.#clients.size === 0) return
    const payload = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : Buffer.from(chunk)
    const frame = encodeData(payload)
    for (const client of this.#clients) {
      this.#safeWrite(client, frame)
    }
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    for (const client of [...this.#clients]) {
      try {
        client.socket.end()
      } catch {
        // ignore
      }
      try {
        client.socket.destroy()
      } catch {
        // ignore
      }
    }
    this.#clients.clear()
    try {
      this.#server.close()
    } catch {
      // ignore
    }
    if (existsSync(this.#socketPath)) {
      try {
        unlinkSync(this.#socketPath)
      } catch {
        // ignore
      }
    }
  }

  #handleClient(socket: Socket): void {
    const client: ClientState = {socket, decoder: new FrameDecoder()}
    this.#clients.add(client)

    socket.on('data', chunk => this.#handleChunk(client, chunk))
    socket.on('error', () => this.#dropClient(client))
    socket.on('close', () => this.#dropClient(client))
  }

  #handleChunk(client: ClientState, chunk: Buffer): void {
    const frames = client.decoder.push(chunk)
    const target = this.#target
    for (const frame of frames) {
      if (frame.type === FRAME_DATA && target) {
        target.pty.write(frame.payload.toString('utf8'))
      } else if (frame.type === FRAME_RESIZE && target) {
        const dims = parseResize(frame.payload)
        if (dims) {
          // Best-effort; ignore promise rejection (e.g. session disposed).
          void target.resize(dims.cols, dims.rows)
        }
      } else if (frame.type === FRAME_DETACH) {
        try {
          client.socket.end()
        } catch {
          // ignore
        }
        this.#dropClient(client)
      }
    }
  }

  #safeWrite(client: ClientState, data: Buffer): void {
    try {
      client.socket.write(data)
    } catch {
      this.#dropClient(client)
    }
  }

  #dropClient(client: ClientState): void {
    if (!this.#clients.has(client)) return
    this.#clients.delete(client)
    try {
      client.socket.destroy()
    } catch {
      // ignore
    }
  }
}
