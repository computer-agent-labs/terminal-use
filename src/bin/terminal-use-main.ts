import {parseArgs} from 'node:util'

import {serveStdio} from '@modelcontextprotocol/server/stdio'

import {runAttachClient} from '../attach/client.js'
import {createTerminalUse, type CreateOptions} from '../index.js'
import {VERSION} from '../version.js'

function intArg(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined
  const n = Number.parseInt(value, 10)
  if (!Number.isFinite(n) || n < 1) {
    console.error(`Invalid --${name}: ${value}`)
    process.exit(1)
  }
  return n
}

function printUsage(): void {
  console.error(
    [
      'terminal-use - MCP server for driving a real PTY/TTY',
      '',
      'Usage:',
      '  terminal-use [options]                    Run as an MCP server over stdio',
      '  terminal-use attach <id> [--resize]       Attach to a running session',
      '',
      'Server options:',
      '  --shell <path>      Shell to spawn (default: $SHELL or /bin/bash)',
      '  --cwd <path>        Working directory for the shell (default: process cwd)',
      '  --cols <n>          Initial columns (default: 120)',
      '  --rows <n>          Initial rows (default: 30)',
      '  --scrollback <n>    Scrollback lines retained (default: 5000)',
      '  --login             Start shells as login shells (reads ~/.zprofile etc.)',
      '  -h, --help          Show this help',
      '  -v, --version       Print the version'
    ].join('\n')
  )
}

const argv = process.argv.slice(2)

// Subcommand dispatch: `terminal-use attach <id>` runs the attach client; otherwise
// we run as an MCP server with the usual flag set.
if (argv[0] === 'attach') {
  await runAttachClient(argv.slice(1))
  process.exit(0)
}

const parsed = parseArgs({
  args: argv,
  options: {
    shell: {type: 'string'},
    cwd: {type: 'string'},
    cols: {type: 'string'},
    rows: {type: 'string'},
    scrollback: {type: 'string'},
    login: {type: 'boolean'},
    help: {type: 'boolean', short: 'h'},
    version: {type: 'boolean', short: 'v'}
  },
  allowPositionals: false,
  strict: true
})

if (parsed.values.help) {
  printUsage()
  process.exit(0)
}

if (parsed.values.version) {
  console.log(VERSION)
  process.exit(0)
}

const opts: CreateOptions = {
  defaults: {
    shell: parsed.values.shell,
    cwd: parsed.values.cwd,
    cols: intArg(parsed.values.cols, 'cols'),
    rows: intArg(parsed.values.rows, 'rows'),
    scrollback: intArg(parsed.values.scrollback, 'scrollback'),
    login: parsed.values.login
  } as CreateOptions['defaults']
}

const {buildServer, dispose} = createTerminalUse(opts)

// Leave nothing behind: kill the shells and unlink the attach sockets
// whichever way we go down. A plain signal death skips 'exit' handlers, so
// the signals are handled explicitly; stdin closing means the MCP client is
// gone (the SDK transport doesn't watch for that), and without this the
// server would live on as an orphan holding its shells open.
let shuttingDown = false
const shutdown = (code: number) => {
  if (shuttingDown) return
  shuttingDown = true
  try {
    dispose()
  } catch {
    // exiting anyway
  }
  process.exit(code)
}
process.on('SIGINT', () => shutdown(130))
process.on('SIGTERM', () => shutdown(143))
process.on('SIGHUP', () => shutdown(129))
process.stdin.on('end', () => shutdown(0))
process.stdin.on('close', () => shutdown(0))
process.on('exit', () => {
  if (!shuttingDown) dispose()
})

// serveStdio picks the protocol era from the client's opening message:
// the stateless 2026-07-28 revision, or the 2025 initialize handshake for
// clients that haven't moved yet. Either way the terminals are shared.
serveStdio(buildServer, {
  onerror: err => console.error(`[terminal-use] ${err.message}`)
})
