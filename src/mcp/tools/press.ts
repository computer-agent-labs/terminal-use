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

export const pressKey = defineTool({
  name: 'terminal_press',
  description:
    'Press a single named key or key combination. Examples of supported `key` values: ' +
    '`Enter`, `Tab`, `Escape`, `Backspace`, `Space`, `ArrowUp` / `ArrowDown` / `ArrowLeft` / `ArrowRight`, ' +
    '`Home`, `End`, `PageUp`, `PageDown`, `Delete`, `Insert`, `F1`..`F12`, ' +
    '`Ctrl+C`, `Ctrl+D`, `Ctrl+L`, `Ctrl+A`..`Ctrl+Z`, `Shift+Tab`, `Alt+B`, ' +
    '`Ctrl+ArrowLeft`, `Ctrl+Shift+ArrowRight`, etc. ' +
    'Same settle behavior as `terminal_type`.',
  schema: {
    sessionId: requiredSessionIdField,
    key: z
      .string()
      .min(1)
      .describe('Key spec like "Enter", "Ctrl+C", "Shift+Tab", "ArrowUp", "F5", "Ctrl+Shift+ArrowLeft".'),
    count: z
      .number()
      .int()
      .min(1)
      .max(1000)
      .optional()
      .describe('Press the key this many times in a row (e.g. ArrowUp x 5). Default 1.'),
    idleMs: z.number().int().min(0).max(HARD_CAP_MS).optional(),
    maxWaitMs: z.number().int().min(0).optional()
  },
  annotations: {readOnlyHint: false},
  handler: async (request, response, context) => {
    const idleMs = request.params.idleMs ?? 200
    const maxWaitMs = request.params.maxWaitMs ?? 5000
    const count = request.params.count ?? 1
    const session = context.session()
    const result = await session.pressKey(request.params.key, count, {idleMs, maxWaitMs})
    response.appendLine(
      count === 1
        ? `Pressed ${request.params.key}.`
        : `Pressed ${request.params.key} x ${count}.`
    )
    appendSettleNote(response, result)
    // Same race as terminal_type — Ctrl+D or any key that ends the shell
    // can dispose the session before we get to read its state.
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
