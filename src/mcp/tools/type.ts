import {z} from 'zod'

import {HARD_CAP_MS} from '../../emulator/settle.js'
import {defineTool} from '../ToolDefinition.js'
import {appendBufferState, appendSettleNote, renderReadWindow} from './shared.js'

export const typeText = defineTool({
  name: 'terminal_type',
  description:
    'Type literal characters into the terminal as if a human were pressing keys. ' +
    "Embedded `\\n` is normalized to `\\r` so `\"git push\\n\"` actually submits. " +
    'Always waits for the buffer to settle (or to time out) before returning. ' +
    'If `maxWaitMs > 10000`, returns immediately without waiting and asks you to ' +
    'call `terminal_read` later.',
  schema: {
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
        `Overall cap. If > ${HARD_CAP_MS}, the server returns immediately without waiting. Default 5000.`
      )
  },
  annotations: {readOnlyHint: false},
  handler: async (request, response, context) => {
    const idleMs = request.params.idleMs ?? 200
    const maxWaitMs = request.params.maxWaitMs ?? 5000
    const session = context.getSession()
    const result = await session.writeText(request.params.text, {idleMs, maxWaitMs})
    response.appendLine(`Typed ${request.params.text.length} chars.`)
    appendSettleNote(response, result, maxWaitMs)
    response.appendBlank()
    appendBufferState(response, session.state())
    response.appendBlank()
    renderReadWindow(response, session.read(session.term.rows, 0))
  }
})
