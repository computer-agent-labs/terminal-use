import { z } from 'zod';
import { defineTool } from '../ToolDefinition.js';
import { appendBufferState, requiredSessionIdField } from './shared.js';
export const resize = defineTool({
    name: 'terminal_resize',
    description: 'Change the terminal size. Both `cols` and `rows` are optional; omitting one preserves the current value. ' +
        'Resizes both the PTY and the emulator (so programs running inside see the change via SIGWINCH).',
    schema: {
        sessionId: requiredSessionIdField,
        cols: z
            .number()
            .int()
            .min(1)
            .max(1000)
            .optional()
            .describe('New column count (1..1000). Omit to keep current cols.'),
        rows: z
            .number()
            .int()
            .min(1)
            .max(1000)
            .optional()
            .describe('New row count (1..1000). Omit to keep current rows.')
    },
    annotations: { readOnlyHint: false },
    handler: async (request, response, context) => {
        const session = context.session();
        const before = { cols: session.term.cols, rows: session.term.rows };
        const after = await session.resize(request.params.cols, request.params.rows);
        response.appendLine(before.cols === after.cols && before.rows === after.rows
            ? `Terminal already ${after.cols}x${after.rows}; no change.`
            : `Resized terminal from ${before.cols}x${before.rows} to ${after.cols}x${after.rows}.`);
        response.appendBlank();
        appendBufferState(response, session.state());
    }
});
//# sourceMappingURL=resize.js.map