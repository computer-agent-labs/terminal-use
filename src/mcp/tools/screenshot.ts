import {writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {z} from 'zod'

import {renderToPng} from '../../emulator/render.js'
import {defineTool} from '../ToolDefinition.js'

import {appendBufferState, appendSessionHeader, sessionIdField} from './shared.js'

const INLINE_LIMIT_BYTES = 2 * 1024 * 1024

export const screenshot = defineTool({
  name: 'terminal_screenshot',
  description:
    'Render a screen-sized window of the terminal to a PNG. Height is always the current ' +
    'screen height (`term.rows`); use `page` to walk back through scrollback in screen-sized ' +
    'increments at the same dimensions as the live screen. ' +
    'If `filePath` is set, the PNG is written there and the path is returned. Large images ' +
    `(>${INLINE_LIMIT_BYTES} bytes) are also spilled to a temp file automatically.`,
  schema: {
    sessionId: sessionIdField,
    page: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe(
        '0 = current live screen. N = the screen-sized window N screens earlier. Past-top clamps.'
      ),
    filePath: z
      .string()
      .optional()
      .describe('Absolute path to write the PNG to. If unset, image is inlined as base64.')
  },
  annotations: {readOnlyHint: true},
  handler: async (request, response, context) => {
    const session = context.session()
    appendSessionHeader(response, context, context.activeId())
    const page = request.params.page ?? 0
    const result = renderToPng(session.term, {page})

    appendBufferState(response, session.state())
    response.appendBlank()
    response.appendLine(
      `Rendered ${result.width}x${result.height} PNG (${result.buffer.length} bytes) for page ${page}.`
    )

    if (request.params.filePath || result.buffer.length > INLINE_LIMIT_BYTES) {
      const path =
        request.params.filePath ??
        join(tmpdir(), `terminal-use-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`)
      await writeFile(path, result.buffer)
      response.appendLine(`Saved to ${path}.`)
      return
    }

    response.attachImage({
      data: result.buffer.toString('base64'),
      mimeType: 'image/png'
    })
  }
})
