import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { call, startServer } from './helpers.js';
let harness;
beforeEach(async () => {
    harness = await startServer();
});
afterEach(async () => {
    await harness.shutdown();
});
describe('terminal_create response includes attach info', () => {
    it('quotes the attach command using the bin path and the session id', async () => {
        const r = await call(harness.client, 'terminal_create', { label: 'attach-info' });
        expect(r.isError).toBe(false);
        expect(r.text).toMatch(/node .* attach 1\b/);
        expect(r.text).toMatch(/terminal-use-\d+-1\.sock/);
        expect(r.text).toMatch(/Ctrl\+\]/);
    });
    it('disclaims that the attach command is for the human user, not the agent', async () => {
        const r = await call(harness.client, 'terminal_create', {});
        expect(r.isError).toBe(false);
        // We point the agent at this command, but very specifically tell them it's
        // for the user — agents should NOT shell out to it themselves.
        expect(r.text).toMatch(/FOR THE HUMAN USER/i);
        expect(r.text).toMatch(/Do NOT run this command yourself/i);
    });
    it('the socket path mentioned in the response actually exists on disk', async () => {
        const r = await call(harness.client, 'terminal_create', {});
        expect(r.isError).toBe(false);
        // tmpdir() is /tmp on Linux but /var/folders/.../T on macOS — match either.
        const match = r.text.match(/\S*terminal-use-\d+-\d+\.sock/);
        expect(match).not.toBeNull();
        const { existsSync, statSync } = await import('node:fs');
        expect(existsSync(match[0])).toBe(true);
        expect(statSync(match[0]).isSocket()).toBe(true);
    });
});
//# sourceMappingURL=attachInfo.test.js.map