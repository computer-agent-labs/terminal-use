import {z} from 'zod'

import {defineTool} from '../ToolDefinition.js'

import {appendBufferState, appendSessionHeader, sessionIdField} from './shared.js'

export const reset = defineTool({
  name: 'terminal_reset',
  description:
    'Wipe the terminal buffer and scrollback. By default the shell process keeps running ' +
    '(env vars, cwd, history all preserved). Pass `hardReset: true` to kill the current shell ' +
    'and spawn a brand-new one — anything mid-execution gets killed. ' +
    'When `hardReset: true`, you can also override `cols`, `rows`, `shell`, and `cwd`.',
  schema: {
    sessionId: sessionIdField,
    hardReset: z
      .boolean()
      .optional()
      .describe('Kill + respawn the shell instead of just clearing the buffer. Default false.'),
    cols: z.number().int().min(1).max(1000).optional().describe('hardReset only: spawn at this width.'),
    rows: z.number().int().min(1).max(1000).optional().describe('hardReset only: spawn at this height.'),
    shell: z.string().optional().describe('hardReset only: shell command (default $SHELL).'),
    cwd: z.string().optional().describe('hardReset only: working directory for the new shell.')
  },
  annotations: {readOnlyHint: false},
  handler: async (request, response, context) => {
    const session = context.session()
    appendSessionHeader(response, context, context.activeId())
    if (request.params.hardReset) {
      await session.hardReset({
        cols: request.params.cols,
        rows: request.params.rows,
        shell: request.params.shell,
        cwd: request.params.cwd
      })
      response.appendLine(
        `Hard reset: spawned a fresh ${session.config.shell} (pid ${session.pty.pid}) ` +
          `at ${session.config.cwd}, ${session.term.cols}x${session.term.rows}.`
      )
      response.appendBlank()
      appendBufferState(response, session.state())
      return
    }

    await session.softReset()
    response.appendLine(
      `Soft reset: buffer wiped, shell process (pid ${session.pty.pid}) preserved.`
    )
    response.appendBlank()
    appendBufferState(response, session.state())
  }
})
