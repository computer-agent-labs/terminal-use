import {parseArgs} from 'node:util'

import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js'

import {runAttachClient} from '../attach/client.js'
import {createMcpServer, type CreateOptions} from '../index.js'

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
      '  -h, --help          Show this help'
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
    help: {type: 'boolean', short: 'h'}
  },
  allowPositionals: false,
  strict: true
})

if (parsed.values.help) {
  printUsage()
  process.exit(0)
}

const opts: CreateOptions = {
  defaults: {
    shell: parsed.values.shell,
    cwd: parsed.values.cwd,
    cols: intArg(parsed.values.cols, 'cols'),
    rows: intArg(parsed.values.rows, 'rows'),
    scrollback: intArg(parsed.values.scrollback, 'scrollback')
  } as CreateOptions['defaults']
}

const server = createMcpServer(opts)
const transport = new StdioServerTransport()
await server.connect(transport)
