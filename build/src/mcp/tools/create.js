import { realpathSync } from 'node:fs';
import { z } from 'zod';
import { THEMES } from '../../emulator/palette.js';
import { defineTool } from '../ToolDefinition.js';
import { describeSessionLine } from './shared.js';
const THEME_NAMES = Object.keys(THEMES);
// Resolve the bin path once at module load so we can quote it back to the
// agent in every terminal_create response. `process.argv[1]` is the entry
// script we were invoked with (typically the absolute path passed to
// `claude mcp add terminal-use -- node /abs/path/terminal-use.js`).
const BIN_PATH = (() => {
    try {
        return realpathSync(process.argv[1] ?? '');
    }
    catch {
        return process.argv[1] ?? 'terminal-use';
    }
})();
export const create = defineTool({
    name: 'terminal_create',
    description: 'Spawn a new terminal session and return its sessionId. You must call this before any per-session ' +
        'tool — there is no shared default session. ' +
        'If the server already holds 50 live sessions, the least-recently-used one is evicted to make room ' +
        "(its sessionId is tombstoned and any later call against it will respawn with an 'evicted' notice).",
    schema: {
        label: z
            .string()
            .min(1)
            .max(64)
            .optional()
            .describe('Optional human-readable name shown in terminal_list output (e.g. "dev-server").'),
        cols: z.number().int().min(1).max(1000).optional(),
        rows: z.number().int().min(1).max(1000).optional(),
        shell: z.string().optional().describe('Override the default shell (e.g. "/bin/zsh").'),
        cwd: z.string().optional().describe('Override the default working directory.'),
        scrollback: z.number().int().min(100).max(50000).optional(),
        theme: z
            .enum(THEME_NAMES)
            .optional()
            .describe('Color palette used by terminal_screenshot and terminal_click previews for THIS session. ' +
            'Persists across auto-respawn / hardReset. Default "dark" (VS Code Dark+). Options: ' +
            THEME_NAMES.map(n => `"${n}"`).join(', ') +
            '.')
    },
    annotations: { readOnlyHint: false },
    needsSession: false,
    handler: async (request, response, context) => {
        const desc = context.createSession({
            label: request.params.label,
            cols: request.params.cols,
            rows: request.params.rows,
            shell: request.params.shell,
            cwd: request.params.cwd,
            scrollback: request.params.scrollback,
            theme: request.params.theme
        });
        response.appendLine(`Created session ${desc.sessionId}${desc.label ? ` ("${desc.label}")` : ''}.`);
        response.appendLine(describeSessionLine(desc));
        response.appendBlank();
        response.appendLine('FOR THE HUMAN USER (not for you, the agent): if the user wants to look in on ' +
            'this session or type into it from their own terminal alongside you, share this ' +
            'command for them to run in their own terminal:');
        response.appendLine(`    node ${BIN_PATH} attach ${desc.sessionId}`);
        response.appendLine('(They press Ctrl+] to detach. They can pass --resize to make their terminal ' +
            "size override the session's. The socket lives at " +
            context.socketPathFor(desc.sessionId) +
            ' and survives shell exits and auto-respawns. Do NOT run this command yourself — ' +
            'you already drive this session through the terminal_* tools; the attach command ' +
            'is a separate CLI for the human user.)');
    }
});
//# sourceMappingURL=create.js.map