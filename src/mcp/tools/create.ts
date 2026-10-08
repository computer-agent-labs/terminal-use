import {realpathSync} from 'node:fs'

import {z} from 'zod'

import {THEMES} from '../../emulator/palette.js'
import {defineTool} from '../ToolDefinition.js'

import {describeSessionLine} from './shared.js'

const THEME_NAMES = Object.keys(THEMES) as Array<keyof typeof THEMES>

// Resolve the bin path once at module load so we can quote it back to the
// agent in every terminal_create response. `process.argv[1]` is the entry
// script we were invoked with (typically the absolute path passed to
// `claude mcp add terminal-use -- node /abs/path/terminal-use.js`).
const BIN_PATH = (() => {
  try {
    return realpathSync(process.argv[1] ?? '')
  } catch {
    return process.argv[1] ?? 'terminal-use'
  }
})()

function shellQuote(s: string): string {
  // Windows paths are full of backslashes, and neither cmd.exe nor
  // PowerShell reads POSIX single-quote escapes; double quotes work in both.
  if (process.platform === 'win32') return /^[\w@%+=:,./\\-]+$/.test(s) ? s : `"${s}"`
  return /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, "'\\''")}'`
}

export const create = defineTool({
  name: 'terminal_create',
  title: 'Create terminal session',
  description:
    'Spawn a new terminal session and return its sessionId. You must call this before any per-session ' +
    'tool — there is no shared default session. ' +
    'By default the session is an interactive shell. Pass `command` to run one program in the terminal ' +
    'instead (a TUI, a test run, a CLI under test): the session then lasts as long as that program, ' +
    'reports its exit status when it ends, and keeps its final screen readable until you destroy it. ' +
    'If the server already holds 50 live sessions, the least-recently-used one is evicted to make room ' +
    "(its sessionId is tombstoned and any later call against it will respawn with an 'evicted' notice).",
  schema: {
    label: z
      .string()
      .min(1)
      .max(64)
      .optional()
      .describe('Optional human-readable name shown in terminal_list output (e.g. "dev-server").'),
    cols: z.number().int().min(1).max(1000).optional(),
    rows: z.number().int().min(1).max(1000).optional(),
    shell: z
      .string()
      .optional()
      .describe('Override the default shell (e.g. "/bin/zsh"; on Windows "pwsh.exe" or "cmd.exe" instead of PowerShell).'),
    cwd: z.string().optional().describe('Override the default working directory.'),
    command: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Run this command line instead of an interactive shell, e.g. "vim notes.txt" or "npm test". It is ' +
          "run through the session's shell (`sh -c`; on Windows PowerShell `-Command`, or `cmd /c`), so " +
          "quoting, pipes and redirection work as at that shell's prompt. Input tools talk to " +
          'the program directly. When it exits, its exit status is reported, the final screen stays ' +
          'readable, and nothing is restarted automatically.'
      ),
    login: z
      .boolean()
      .optional()
      .describe(
        'Start the shell as a login shell (`-l`), so it reads the profile files (~/.zprofile, ' +
          '~/.bash_profile, ~/.profile) where PATH is usually set up. Use it when tools that work in the ' +
          "user's own terminal are \"command not found\" here — typical when the MCP client was started " +
          'from a GUI rather than a terminal. Slower to start. No effect in PowerShell or cmd.exe. Default ' +
          'false (or the server\'s --login flag).'
      ),
    env: z
      .record(z.string(), z.string())
      .optional()
      .describe('Environment variables to set for the session, on top of the server\'s own environment.'),
    scrollback: z.number().int().min(100).max(50000).optional(),
    theme: z
      .enum(THEME_NAMES as [string, ...string[]])
      .optional()
      .describe(
        'Color palette used by terminal_screenshot and terminal_click previews for THIS session. ' +
          'Persists across auto-respawn / hardReset. Default "dark" (VS Code Dark+). Options: ' +
          THEME_NAMES.map(n => `"${n}"`).join(', ') +
          '.'
      )
  },
  annotations: {readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false},
  needsSession: false,
  handler: async (request, response, context) => {
    const desc = context.createSession({
      label: request.params.label,
      cols: request.params.cols,
      rows: request.params.rows,
      shell: request.params.shell,
      cwd: request.params.cwd,
      scrollback: request.params.scrollback,
      command: request.params.command,
      env: request.params.env,
      login: request.params.login,
      theme: request.params.theme as keyof typeof THEMES | undefined
    })
    await context.waitUntilReady(desc.sessionId)
    response.appendLine(`Created session ${desc.sessionId}${desc.label ? ` ("${desc.label}")` : ''}.`)
    response.appendLine(describeSessionLine(desc))
    response.appendBlank()
    response.appendLine(
      'FOR THE HUMAN USER (not for you, the agent): if the user wants to look in on ' +
        'this session or type into it from their own terminal alongside you, share this ' +
        'command for them to run in their own terminal:'
    )
    // --socket pins the command to THIS server: several terminal-use servers
    // (one per MCP client) routinely run at once, each numbering from 1.
    const socketPath = context.socketPathFor(desc.sessionId)
    response.appendLine(
      `    node ${shellQuote(BIN_PATH)} attach ${desc.sessionId} --socket ${shellQuote(socketPath)}`
    )
    response.appendLine(
      '(They press Ctrl+] to detach. They can pass --resize to make their terminal ' +
        "size override the session's. The socket survives shell exits and auto-respawns. " +
        'Do NOT run this command yourself — ' +
        'you already drive this session through the terminal_* tools; the attach command ' +
        'is a separate CLI for the human user.)'
    )
  }
})
