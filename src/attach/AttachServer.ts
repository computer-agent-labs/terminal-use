import {chmodSync, existsSync, mkdirSync, unlinkSync} from 'node:fs'
import {createServer, type Server, type Socket} from 'node:net'
import {tmpdir, userInfo} from 'node:os'
import {join} from 'node:path'

import type {TerminalSession} from '../session/TerminalSession.js'

import {encodeData, FRAME_DATA, FRAME_DETACH, FRAME_RESIZE, FrameDecoder, parseResize} from './framing.js'

const IS_WINDOWS = process.platform === 'win32'

/** How much history a newly attached client gets replayed, in lines. */
const REPLAY_SCROLLBACK = 1000

/**
 * Directory holding every attach socket of this user. Private (0700) so
 * that no other local user can reach a socket even in the instant between
 * bind() and chmod() — connecting to one is equivalent to a shell.
 */
export function socketDir(): string {
  let uid = 'user'
  try {
    uid = String(userInfo().uid)
  } catch {
    // no passwd entry (some containers) — fall through to the shared name
  }
  return join(tmpdir(), `terminal-use-${uid}`)
}

export function socketPathFor(serverPid: number, sessionId: number): string {
  // Windows has no filesystem Unix sockets; node's net module wants a
  // named pipe there. (Untested on Windows — see README.)
  if (IS_WINDOWS) return `\\\\.\\pipe\\terminal-use-${serverPid}-${sessionId}`
  return join(socketDir(), `terminal-use-${serverPid}-${sessionId}.sock`)
}

interface ClientState {
  socket: Socket
  decoder: FrameDecoder
  /** False until the catch-up replay has been sent; live output waits for it. */
  ready: boolean
}

/**
 * Hosts a Unix domain socket for one terminal-use session. Multiplexes any
 * number of attached human clients onto a single underlying TerminalSession.
 *
 * Lifecycle:
 *   - `new AttachServer(socketPath)` creates and listens on the socket
 *     (mode 0600 inside a 0700 directory — same Unix user only). If the
 *     socket can't be bound, attach is unavailable for that session but
 *     the session itself is unaffected.
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
  #error: Error | undefined

  constructor(socketPath: string) {
    this.#socketPath = socketPath
    if (!IS_WINDOWS) {
      try {
        mkdirSync(socketDir(), {recursive: true, mode: 0o700})
        chmodSync(socketDir(), 0o700)
      } catch {
        // listen() will surface the failure via the error handler below
      }
    }
    // Best-effort: clean up any leftover socket file from a crashed
    // previous run before binding.
    if (!IS_WINDOWS && existsSync(socketPath)) {
      try {
        unlinkSync(socketPath)
      } catch {
        // ignore — listen() will surface a clearer error
      }
    }
    this.#server = createServer(socket => this.#handleClient(socket))
    // Without a listener a failed bind (path too long, unwritable tmpdir,
    // unsupported platform) would be an uncaught exception and take the
    // whole MCP server down. Attach is optional; the session is not.
    this.#server.on('error', err => {
      this.#error = err
    })
    this.#server.listen(socketPath, () => {
      if (IS_WINDOWS) return
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

  /** Set if the socket could not be bound; attach is unavailable. */
  get error(): Error | undefined {
    return this.#error
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
      if (client.ready) this.#safeWrite(client, frame)
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
    if (!IS_WINDOWS && existsSync(this.#socketPath)) {
      try {
        unlinkSync(this.#socketPath)
      } catch {
        // ignore
      }
    }
  }

  #handleClient(socket: Socket): void {
    const client: ClientState = {socket, decoder: new FrameDecoder(), ready: false}
    this.#clients.add(client)
    void this.#replay(client)

    socket.on('data', chunk => this.#handleChunk(client, chunk))
    socket.on('error', () => this.#dropClient(client))
    socket.on('close', () => this.#dropClient(client))
  }

  /**
   * Bring a new client up to date: paint the session's current screen (and
   * some scrollback) before any live output, so attaching to an idle shell
   * or a running TUI doesn't show a blank terminal until the next redraw.
   */
  async #replay(client: ClientState): Promise<void> {
    const target = this.#target
    try {
      if (target?.isAlive) {
        // Everything received so far must be in the emulator before we
        // snapshot it; output arriving meanwhile is parsed in order and so
        // lands in the snapshot rather than being broadcast to this client.
        await target.flush()
        if (target === this.#target && target.isAlive && this.#clients.has(client)) {
          const snapshot = target.serialize(REPLAY_SCROLLBACK)
          if (snapshot) this.#safeWrite(client, encodeData(Buffer.from(snapshot, 'utf8')))
        }
      }
    } catch {
      // replay is a nicety — fall through to live output
    }
    client.ready = true
  }

  #handleChunk(client: ClientState, chunk: Buffer): void {
    const frames = client.decoder.push(chunk)
    const target = this.#target
    for (const frame of frames) {
      if (frame.type === FRAME_DATA && target?.isAlive) {
        target.pty.write(frame.payload.toString('utf8'))
      } else if (frame.type === FRAME_RESIZE && target?.isAlive) {
        const dims = parseResize(frame.payload)
        if (dims) {
          // Best-effort (e.g. session disposed underneath us).
          target.resize(dims.cols, dims.rows).catch(() => undefined)
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
