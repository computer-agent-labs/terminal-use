import { z } from 'zod';
import { HARD_CAP_MS } from '../../emulator/settle.js';
import { defineTool } from '../ToolDefinition.js';
import { appendBufferState, appendSettleNote, renderReadWindow, requiredSessionIdField } from './shared.js';
export const typeText = defineTool({
    name: 'terminal_type',
    description: 'Type literal characters into the terminal as if a human were pressing keys. ' +
        'Embedded `\\n` is normalized to `\\r` so `"git push\\n"` actually submits. ' +
        'Always waits for the buffer to settle (or to time out) before returning. ' +
        'If `maxWaitMs > 10000`, returns immediately without waiting and asks you to ' +
        'call `terminal_read` later.',
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
            .describe(`Overall cap. If > ${HARD_CAP_MS}, the server returns immediately without waiting. Default 5000.`)
    },
    annotations: { readOnlyHint: false },
    handler: async (request, response, context) => {
        const idleMs = request.params.idleMs ?? 200;
        const maxWaitMs = request.params.maxWaitMs ?? 5000;
        const session = context.session();
        const result = await session.writeText(request.params.text, { idleMs, maxWaitMs });
        response.appendLine(`Typed ${request.params.text.length} chars.`);
        appendSettleNote(response, result, maxWaitMs);
        // The shell can exit during settle (e.g. agent typed `exit`). When that
        // happens, McpContext's pty.onExit listener disposes the session
        // synchronously, and any further access to session.state()/.read()
        // would throw "TerminalSession has been disposed." Detect and exit
        // gracefully — the next tool call against this id auto-respawns.
        if (!session.isAlive) {
            response.appendBlank();
            response.appendLine('The shell exited during this call. The next tool call against this ' +
                'sessionId will auto-respawn — re-issue your command if relevant.');
            return;
        }
        response.appendBlank();
        appendBufferState(response, session.state());
        response.appendBlank();
        renderReadWindow(response, session.read(session.term.rows, 0));
    }
});
//# sourceMappingURL=type.js.map