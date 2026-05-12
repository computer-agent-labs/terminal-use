import {writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {z} from 'zod'

import {THEMES} from '../../emulator/palette.js'
import {renderToPng} from '../../emulator/render.js'
import {HARD_CAP_MS} from '../../emulator/settle.js'
import {defineTool} from '../ToolDefinition.js'

import {appendBufferState, appendSettleNote, renderReadWindow, requiredSessionIdField} from './shared.js'

const INLINE_LIMIT_BYTES = 2 * 1024 * 1024

export const click = defineTool({
  name: 'terminal_click',
  description:
    'Deliver a left mouse-button click at a cell in the terminal. Only works when the program ' +
    'currently in the foreground has opted into mouse tracking (vim with `set mouse=a`, fzf, ' +
    'lazygit, less with mouse mode, etc.) — at a plain shell prompt mouse mode is off and the ' +
    'click would just print escape sequences as text, so we refuse the actual click in that case.\n\n' +
    'Coordinates are 1-indexed and refer to the live screen viewport: col 1, row 1 is the top-left ' +
    'cell, and the bottom-right cell is (terminal width, terminal height) which you can see via ' +
    "`terminal_read`'s state header.\n\n" +
    'PREVIEW MODE (default `preview: true`): does NOT click. Returns a PNG with a bright magenta ' +
    'ring + dot drawn around the target cell so you can verify your coordinates. Always do this ' +
    'first when you are not 100% sure where the click should land — TUIs often have destructive ' +
    'actions one click away (delete branch, kill process, etc.).\n\n' +
    'EXECUTE MODE (`preview: false`): actually sends the mouse press+release sequence and settles ' +
    "for output. Use this only after you've previewed and confirmed, or when you're confident.\n\n" +
    "CAVEATS: `idleMs` and `maxWaitMs` are ignored in preview mode (preview doesn't settle). " +
    'When the target cell is near the right edge of the viewport, the coordinate label drawn next ' +
    'to the magenta ring may be clipped — the ring itself is always within frame, so trust it ' +
    'over the label.',
  schema: {
    sessionId: requiredSessionIdField,
    col: z
      .number()
      .int()
      .min(1)
      .max(1000)
      .describe('1-indexed column. Column 1 is the leftmost cell on the visible viewport.'),
    row: z
      .number()
      .int()
      .min(1)
      .max(1000)
      .describe('1-indexed row. Row 1 is the top of the visible viewport.'),
    preview: z
      .boolean()
      .optional()
      .describe(
        'When true (DEFAULT), render a PNG with a bright magenta ring around the target cell ' +
          'WITHOUT actually clicking. When false, deliver the click and settle for output. ' +
          'Set to false explicitly when you are confident about the coordinates.'
      ),
    filePath: z
      .string()
      .optional()
      .describe('Preview only: absolute path to write the PNG to. If unset, image is inlined as base64.'),
    idleMs: z.number().int().min(0).max(HARD_CAP_MS).optional(),
    maxWaitMs: z.number().int().min(0).optional()
  },
  annotations: {readOnlyHint: false},
  handler: async (request, response, context) => {
    const session = context.session()
    const col = request.params.col
    const row = request.params.row
    const preview = request.params.preview ?? true
    const idleMs = request.params.idleMs ?? 200
    const maxWaitMs = request.params.maxWaitMs ?? 5000

    if (col > session.term.cols || row > session.term.rows) {
      throw new Error(
        `(col ${col}, row ${row}) is outside the ${session.term.cols}x${session.term.rows} viewport. ` +
          'Check terminal_read for the current size.'
      )
    }

    if (preview) {
      response.appendLine(
        `PREVIEW: click at (col ${col}, row ${row}). No click was sent. Set \`preview: false\` to execute.`
      )
      response.appendBlank()
      appendBufferState(response, session.state())
      response.appendBlank()
      const themeName = context.themeOf(context.activeId())
      const theme = themeName ? THEMES[themeName] : undefined
      const result = renderToPng(session.term, {clickMarker: {col, row}, theme})
      response.appendLine(
        `Rendered ${result.width}x${result.height} preview PNG (${result.buffer.length} bytes).`
      )
      if (request.params.filePath || result.buffer.length > INLINE_LIMIT_BYTES) {
        const path =
          request.params.filePath ??
          join(
            tmpdir(),
            `terminal-use-click-preview-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`
          )
        await writeFile(path, result.buffer)
        response.appendLine(`Saved to ${path}.`)
      } else {
        response.attachImage({
          data: result.buffer.toString('base64'),
          mimeType: 'image/png'
        })
      }
      return
    }

    if (!session.isMouseModeEnabled()) {
      response.setError(
        `(col ${col}, row ${row}): the foreground program has not enabled mouse tracking, so a ` +
          'click would just print escape sequences as visible text. This is usually the case at a ' +
          'plain shell prompt. Inside a TUI (vim with `set mouse=a`, fzf, lazygit, less, etc.) ' +
          'mouse mode is auto-enabled on startup. If you genuinely want to print the click ' +
          'sequence (e.g. testing), use terminal_type directly.'
      )
      return
    }

    const result = await session.sendLeftClick(col, row, {idleMs, maxWaitMs})
    response.appendLine(`Clicked at (col ${col}, row ${row}).`)
    appendSettleNote(response, result, maxWaitMs)
    response.appendBlank()
    appendBufferState(response, session.state())
    response.appendBlank()
    renderReadWindow(response, session.read(session.term.rows, 0))
  }
})
