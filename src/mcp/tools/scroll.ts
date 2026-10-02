import {z} from 'zod'

import {HARD_CAP_MS} from '../../emulator/settle.js'
import {defineTool} from '../ToolDefinition.js'

import {appendBufferState, appendSettleNote, renderReadWindow, requiredSessionIdField} from './shared.js'

export const scroll = defineTool({
  name: 'terminal_scroll',
  title: 'Scroll in terminal',
  description:
    'Turn the mouse wheel over a cell of a full-screen program: scroll a pager, a file list, a log pane. ' +
    'Behaves as a terminal emulator does — programs that track the mouse receive wheel events at that ' +
    'cell (so the pane under it scrolls); full-screen programs that do not (less, man) receive arrow keys ' +
    'instead. At a plain shell prompt there is nothing to scroll and the call fails: earlier output is read ' +
    'with `terminal_read` and its `page` argument, not by scrolling.',
  schema: {
    sessionId: requiredSessionIdField,
    direction: z.enum(['up', 'down']).describe('"up" moves toward earlier content, "down" toward later.'),
    amount: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe('Wheel notches. Most programs move about 3 lines per notch. Default 3.'),
    col: z
      .number()
      .int()
      .min(1)
      .max(1000)
      .optional()
      .describe('1-indexed column the pointer is over. Matters when panes scroll independently. Default: screen center.'),
    row: z
      .number()
      .int()
      .min(1)
      .max(1000)
      .optional()
      .describe('1-indexed row the pointer is over. Default: screen center.'),
    idleMs: z.number().int().min(0).max(HARD_CAP_MS).optional(),
    maxWaitMs: z.number().int().min(0).optional()
  },
  annotations: {readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false},
  handler: async (request, response, context) => {
    const session = context.session()
    const {cols, rows} = session.term
    const amount = request.params.amount ?? 3
    const col = request.params.col ?? Math.ceil(cols / 2)
    const row = request.params.row ?? Math.ceil(rows / 2)
    if (col > cols || row > rows) {
      throw new Error(`(col ${col}, row ${row}) is outside the ${cols}x${rows} viewport.`)
    }
    const result = await session.scroll(request.params.direction, amount, col, row, {
      idleMs: request.params.idleMs ?? 200,
      maxWaitMs: request.params.maxWaitMs ?? 5000
    })
    response.appendLine(
      result.via === 'wheel'
        ? `Scrolled ${request.params.direction} ${amount} notch${amount === 1 ? '' : 'es'} at (col ${col}, row ${row}).`
        : `Sent ${amount} Arrow${request.params.direction === 'up' ? 'Up' : 'Down'} key${amount === 1 ? '' : 's'}: ` +
          'the program does not track the mouse, so the wheel acts as arrow keys.'
    )
    appendSettleNote(response, result)
    response.appendBlank()
    appendBufferState(response, session.state())
    response.appendBlank()
    renderReadWindow(response, session.read(rows, 0))
  }
})
