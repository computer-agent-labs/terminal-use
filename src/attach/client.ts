import {readdirSync, statSync, unlinkSync} from 'node:fs'
import {createConnection, type Socket} from 'node:net'
import {join} from 'node:path'
import {parseArgs} from 'node:util'

import {socketDir} from './AttachServer.js'
import {encodeData, encodeDetach, encodeResize, FRAME_DATA, FrameDecoder} from './framing.js'

const DETACH_BYTE = 0x1d // Ctrl+]

// Put the human's terminal back the way a well-behaved program would leave
// it. The session's program (vim, htop…) set these modes for itself and is
// still running — it will never send the matching resets to *this* terminal.
const RESTORE_MODES =
  '\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l' + // mouse tracking off
  '\x1b[?2004l' + // bracketed paste off
  '\x1b[?1l\x1b>' + // normal cursor keys + keypad
  '\x1b[0m\x1b[?25h' // default colors, cursor visible
const LEAVE_ALT_SCREEN = '\x1b[?1049l'
// eslint-disable-next-line no-control-regex
const ALT_SCREEN_TOGGLE = /\x1b\[\?(?:1049|1047|47)([hl])/g

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    // EPERM: exists but isn't ours. Anything else (ESRCH): gone.
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * Find the socket for `sessionId`. Sockets of servers that are no longer
 * running are deleted along the way. Returns every live match so the
 * caller can refuse to guess when several servers each have a session
 * with this id.
 */
export function findSockets(sessionId: number, dir = socketDir()): string[] {
  const suffix = `-${sessionId}.sock`
  const candidates: Array<{path: string; mtime: number}> = []
  let entries: string[] = []
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }
  for (const name of entries) {
    const m = /^terminal-use-(\d+)-\d+\.sock$/.exec(name)
    if (!m) continue
    const path = join(dir, name)
    if (!isProcessAlive(Number.parseInt(m[1]!, 10))) {
      try {
        unlinkSync(path)
      } catch {
        // ignore
      }
      continue
    }
    if (!name.endsWith(suffix)) continue
    try {
      const st = statSync(path)
      candidates.push({path, mtime: st.mtimeMs})
    } catch {
      // ignore
    }
  }
  candidates.sort((a, b) => b.mtime - a.mtime)
  return candidates.map(c => c.path)
}

function getTerminalSize(): {cols: number; rows: number} {
  const out = process.stdout as NodeJS.WriteStream & {columns?: number; rows?: number}
  return {cols: out.columns ?? 80, rows: out.rows ?? 24}
}

function printUsage(): void {
  console.error(
    [
      'terminal-use attach - connect to a running terminal-use session',
      '',
      'Usage: terminal-use attach <sessionId> [--resize] [--socket=PATH]',
      '',
      'Options:',
      '  --resize          On attach (and on every SIGWINCH while attached),',
      '                    resize the session to match this terminal\'s size.',
      '                    Default: leave session size alone.',
      '  --socket <path>   Explicit socket path. Required when several terminal-use',
      '                    servers are running and more than one has a session',
      '                    with this id. terminal_create prints the full command.',
      '  -h, --help        Show this help',
      '',
      'Press Ctrl+] to detach.'
    ].join('\n')
  )
}

export async function runAttachClient(rawArgs: string[]): Promise<void> {
  const parsed = parseArgs({
    args: rawArgs,
    options: {
      resize: {type: 'boolean'},
      socket: {type: 'string'},
      help: {type: 'boolean', short: 'h'}
    },
    allowPositionals: true,
    strict: true
  })

  if (parsed.values.help) {
    printUsage()
    process.exit(0)
  }

  const positional = parsed.positionals
  if (positional.length !== 1) {
    printUsage()
    process.exit(1)
  }
  const sessionId = Number.parseInt(positional[0]!, 10)
  if (!Number.isFinite(sessionId) || sessionId < 1) {
    console.error(`Invalid sessionId: ${positional[0]}`)
    process.exit(1)
  }

  let socketPath = parsed.values.socket
  if (!socketPath) {
    const found = findSockets(sessionId)
    if (found.length === 0) {
      console.error(
        `Could not find a socket for session ${sessionId}. Looked under ${socketDir()} ` +
          'for `terminal-use-*-' +
          sessionId +
          '.sock`. The terminal-use MCP server may not be running, or this session id ' +
          "doesn't exist. Try --socket=PATH if you know the exact path."
      )
      process.exit(1)
    }
    if (found.length > 1) {
      console.error(
        `${found.length} running terminal-use servers each have a session ${sessionId}. ` +
          'Pick one with --socket (terminal_create prints the exact command):\n' +
          found.map(p => `  terminal-use attach ${sessionId} --socket ${p}`).join('\n')
      )
      process.exit(1)
    }
    socketPath = found[0]!
  }

  const resizeOnAttach = parsed.values.resize === true
  try {
    await connectAndPipe(socketPath, sessionId, resizeOnAttach)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    console.error(
      code === 'ECONNREFUSED' || code === 'ENOENT'
        ? `Nothing is listening on ${socketPath} — that terminal-use server has exited or the session was destroyed.`
        : `Attach failed: ${err instanceof Error ? err.message : String(err)}`
    )
    process.exit(1)
  }
}

function connectAndPipe(socketPath: string, sessionId: number, resizeOnAttach: boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket: Socket = createConnection(socketPath)
    let restored = false
    let connected = false
    let inAltScreen = false

    const restore = () => {
      if (restored) return
      restored = true
      process.stdin.off('data', onStdin)
      if (connected && process.stdout.isTTY) {
        try {
          process.stdout.write((inAltScreen ? LEAVE_ALT_SCREEN : '') + RESTORE_MODES)
        } catch {
          // ignore
        }
      }
      try {
        if (process.stdin.isTTY) process.stdin.setRawMode(false)
      } catch {
        // ignore
      }
      try {
        process.stdin.pause()
      } catch {
        // ignore
      }
    }

    const onSigwinch = () => {
      if (!resizeOnAttach) return
      const {cols, rows} = getTerminalSize()
      try {
        socket.write(encodeResize(cols, rows))
      } catch {
        // ignore
      }
    }

    const onStdin = (chunk: Buffer) => {
      // Scan for the detach byte. If present, send everything up to it,
      // then DETACH, then stop.
      const idx = chunk.indexOf(DETACH_BYTE)
      if (idx === -1) {
        socket.write(encodeData(chunk))
        return
      }
      process.stdin.off('data', onStdin)
      if (idx > 0) socket.write(encodeData(chunk.subarray(0, idx)))
      try {
        socket.write(encodeDetach())
      } catch {
        // ignore
      }
      socket.end()
    }

    socket.on('connect', () => {
      connected = true
      console.error(
        `[terminal-use] attached to session ${sessionId} via ${socketPath}. Press Ctrl+] to detach.`
      )

      if (resizeOnAttach) {
        const {cols, rows} = getTerminalSize()
        socket.write(encodeResize(cols, rows))
        process.on('SIGWINCH', onSigwinch)
      }

      const decoder = new FrameDecoder()
      socket.on('data', chunk => {
        for (const frame of decoder.push(chunk)) {
          if (frame.type === FRAME_DATA) {
            process.stdout.write(frame.payload)
            // Remember whether the session last left us on the alternate
            // screen, so detach can put the user's own screen back.
            for (const m of frame.payload.toString('latin1').matchAll(ALT_SCREEN_TOGGLE)) {
              inAltScreen = m[1] === 'h'
            }
          }
        }
      })

      if (process.stdin.isTTY) {
        try {
          process.stdin.setRawMode(true)
        } catch {
          // not fatal — still pipe, just with cooked-mode line buffering
        }
      }
      process.stdin.resume()
      process.stdin.on('data', onStdin)
    })

    socket.on('error', err => {
      restore()
      process.off('SIGWINCH', onSigwinch)
      reject(err)
    })

    socket.on('close', () => {
      restore()
      process.off('SIGWINCH', onSigwinch)
      console.error('\n[terminal-use] detached.')
      resolve()
    })

    const onSignal = () => {
      try {
        socket.write(encodeDetach())
      } catch {
        // ignore
      }
      socket.end()
    }
    process.once('SIGTERM', onSignal)
    process.once('SIGHUP', onSignal)
  })
}
