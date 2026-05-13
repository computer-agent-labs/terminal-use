import { z } from 'zod';
import { defineTool } from '../ToolDefinition.js';
import { appendBufferState, renderReadWindow, requiredSessionIdField } from './shared.js';
export const READ_MAX_ROWS = 1000;
export const read = defineTool({
    name: 'terminal_read',
    description: 'Read a window of the terminal buffer. The buffer is the full xterm-emulated state ' +
        '(scrollback + visible viewport) in one contiguous index space. The window is paged from the ' +
        'bottom upward in multiples of `rows`. ' +
        `\`rows\` defaults to the current screen height and is capped at ${READ_MAX_ROWS}. ` +
        '`page: 0` is the most recent screen-sized chunk; `page: 1` is the screen before that, and so on. ' +
        'Trailing blank rows are trimmed implicitly.',
    schema: {
        sessionId: requiredSessionIdField,
        rows: z
            .number()
            .int()
            .min(1)
            .max(READ_MAX_ROWS)
            .optional()
            .describe(`Window height. Default = current screen height. Max ${READ_MAX_ROWS}.`),
        page: z
            .number()
            .int()
            .min(0)
            .optional()
            .describe('0 = newest screen-sized window. N = scroll up N pages (each page = `rows` lines). Past-top clamps.'),
        cursor: z
            .boolean()
            .optional()
            .describe('When true (default), inject "▌" at the cursor position inline in the rendered text. ' +
            'Set to false if you need the unmodified text.')
    },
    annotations: { readOnlyHint: true },
    handler: async (request, response, context) => {
        const session = context.session();
        const rows = request.params.rows ?? session.term.rows;
        const page = request.params.page ?? 0;
        const showCursor = request.params.cursor ?? true;
        const win = session.read(rows, page);
        appendBufferState(response, win.state);
        response.appendBlank();
        renderReadWindow(response, win, { showCursor });
    }
});
//# sourceMappingURL=read.js.map