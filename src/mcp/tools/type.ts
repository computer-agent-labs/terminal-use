import {z} from 'zod'

import {HARD_CAP_MS} from '../../emulator/settle.js'
import {defineTool} from '../ToolDefinition.js'

import {
  appendBufferState,
  appendSettleNote,
  appendShellExited,
  renderReadWindow,
  requiredSessionIdField
} from './shared.js'

export const typeText = defineTool({
  name: 'terminal_type',
  title: 'Type into terminal',
  description:
    'Type literal characters into the terminal as if a human were pressing keys. ' +
    'Embedded `\\n` is normalized to `\\r` so `"git push\\n"` actually submits. ' +
    'Always waits for the buffer to settle (or to time out) before returning. ' +
    'The wait is capped at 10s; for anything slower (builds, installs, test runs) follow up with ' +
    '`terminal_wait`, which blocks until the command actually finishes.',
  schema: {
    sessionId: requiredSessionIdField,
    text: z.string().describe('Characters to type. Embedded \\n becomes Enter.'),
    idleMs: z
      .number()
      .int()
      .min(0)
      .max(HARD_CAP_MS)
      .optional()
      .describe('Settle window: silence this long after the last byte counts as settled. Default 200.'),
    maxWaitMs: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe(
        `Overall cap on the settle wait. Default 5000, clamped to ${HARD_CAP_MS}. Use terminal_wait for longer.`
      )
  },
  annotations: {readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true},
  handler: async (request, response, context) => {
    const idleMs = request.params.idleMs ?? 200
    const maxWaitMs = request.params.maxWaitMs ?? 5000
    const session = context.session()
    const result = await session.writeText(request.params.text, {idleMs, maxWaitMs})
    response.appendLine(`Typed ${request.params.text.length} chars.`)
    appendSettleNote(response, result)
    // The shell can exit during settle (e.g. agent typed `exit`). When that
    // happens, McpContext's pty.onExit listener disposes the session
    // synchronously, and any further access to session.state()/.read()
    // would throw "TerminalSession has been disposed." Detect and exit
    // gracefully — the next tool call against this id auto-respawns.
    if (!session.isAlive) {
      response.appendBlank()
      appendShellExited(response, session)
      return
    }
    response.appendBlank()
    appendBufferState(response, session.state())
    response.appendBlank()
    renderReadWindow(response, session.read(session.term.rows, 0))
  }
})
