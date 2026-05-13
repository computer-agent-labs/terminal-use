import { readFile, stat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { call, createSession, startServer } from './helpers.js';
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
let harness;
beforeEach(async () => {
    harness = await startServer();
});
afterEach(async () => {
    await harness.shutdown();
});
describe('MCP end-to-end', () => {
    it('lists all ten tools', async () => {
        const list = await harness.client.listTools();
        const names = list.tools.map(t => t.name).sort();
        expect(names).toEqual([
            'terminal_click',
            'terminal_create',
            'terminal_destroy',
            'terminal_list',
            'terminal_press',
            'terminal_read',
            'terminal_reset',
            'terminal_resize',
            'terminal_screenshot',
            'terminal_type'
        ].sort());
    });
    it('per-session tools refuse to run without sessionId (schema rejects)', async () => {
        const r = await call(harness.client, 'terminal_type', { text: 'echo nope\n' });
        expect(r.isError).toBe(true);
        expect(r.text).toMatch(/sessionId/i);
    });
    it('type → press Enter → read shows output', async () => {
        const id = await createSession(harness.client);
        let r = await call(harness.client, 'terminal_type', { sessionId: id, text: 'echo e2e-marker' });
        expect(r.isError).toBe(false);
        r = await call(harness.client, 'terminal_press', { sessionId: id, key: 'Enter' });
        expect(r.isError).toBe(false);
        r = await call(harness.client, 'terminal_read', { sessionId: id });
        expect(r.isError).toBe(false);
        expect(r.text).toMatch(/e2e-marker/);
    });
    it('resize updates the terminal and shell sees it', async () => {
        const id = await createSession(harness.client);
        let r = await call(harness.client, 'terminal_resize', { sessionId: id, cols: 70, rows: 18 });
        expect(r.isError).toBe(false);
        expect(r.text).toMatch(/70x18/);
        r = await call(harness.client, 'terminal_type', {
            sessionId: id,
            text: 'stty size\n',
            idleMs: 300,
            maxWaitMs: 4000
        });
        expect(r.isError).toBe(false);
        expect(r.text).toMatch(/\b18 70\b/);
    });
    it('screenshot returns an inline PNG', async () => {
        const id = await createSession(harness.client);
        await call(harness.client, 'terminal_type', {
            sessionId: id,
            text: 'echo screenshot-marker\n',
            idleMs: 200,
            maxWaitMs: 3000
        });
        const r = await call(harness.client, 'terminal_screenshot', { sessionId: id });
        expect(r.isError).toBe(false);
        expect(r.imageMimeTypes).toEqual(['image/png']);
        expect(r.imageDataLengths[0]).toBeGreaterThan(64);
    });
    it('screenshot of older page works', async () => {
        const id = await createSession(harness.client);
        await call(harness.client, 'terminal_type', {
            sessionId: id,
            text: 'i=1; while [ $i -le 200 ]; do echo line$i; i=$((i+1)); done\n',
            idleMs: 600,
            maxWaitMs: 8000
        });
        const r = await call(harness.client, 'terminal_screenshot', { sessionId: id, page: 5 });
        expect(r.isError).toBe(false);
        expect(r.imageMimeTypes).toEqual(['image/png']);
    });
    it('maxWaitMs > 10000 triggers immediate deferred return', async () => {
        const id = await createSession(harness.client);
        const r = await call(harness.client, 'terminal_type', {
            sessionId: id,
            text: 'echo def\n',
            maxWaitMs: 30000
        });
        expect(r.isError).toBe(false);
        expect(r.text).toMatch(/Did not wait/);
    });
    it('soft reset preserves shell, hard reset replaces it', async () => {
        const id = await createSession(harness.client);
        await call(harness.client, 'terminal_type', {
            sessionId: id,
            text: 'echo $$\n',
            idleMs: 250,
            maxWaitMs: 3000
        });
        const soft = await call(harness.client, 'terminal_reset', { sessionId: id });
        expect(soft.text).toMatch(/Soft reset/);
        const hard = await call(harness.client, 'terminal_reset', { sessionId: id, hardReset: true });
        expect(hard.text).toMatch(/Hard reset/);
    });
    it('screenshot with filePath writes a PNG to disk and inlines nothing', async () => {
        const id = await createSession(harness.client);
        const path = join(tmpdir(), `terminal-use-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`);
        try {
            const r = await call(harness.client, 'terminal_screenshot', { sessionId: id, filePath: path });
            expect(r.isError).toBe(false);
            expect(r.text).toContain(`Saved to ${path}`);
            expect(r.imageMimeTypes).toEqual([]);
            const info = await stat(path);
            expect(info.size).toBeGreaterThan(64);
            const head = await readFile(path);
            expect(head.subarray(0, 8).equals(PNG_SIG)).toBe(true);
        }
        finally {
            await unlink(path).catch(() => undefined);
        }
    });
    it('terminal_read marks the cursor inline by default and can opt out', async () => {
        const id = await createSession(harness.client);
        await call(harness.client, 'terminal_type', {
            sessionId: id,
            text: 'echo cursor-marker-test\n',
            idleMs: 250,
            maxWaitMs: 3000
        });
        const withMark = await call(harness.client, 'terminal_read', { sessionId: id });
        expect(withMark.text).toContain('▌');
        expect(withMark.text).toMatch(/cursor marked with/);
        const noMark = await call(harness.client, 'terminal_read', { sessionId: id, cursor: false });
        expect(noMark.text).not.toContain('▌');
        expect(noMark.text).not.toMatch(/cursor marked with/);
    });
    it('terminal_type returns gracefully when typed command exits the shell mid-settle', async () => {
        const id = await createSession(harness.client, { label: 'will-exit' });
        const r = await call(harness.client, 'terminal_type', {
            sessionId: id,
            text: 'exit\n',
            idleMs: 250,
            maxWaitMs: 3000
        });
        // The typing succeeded; the shell exit during settle should produce a
        // friendly message rather than a "TerminalSession has been disposed"
        // exception.
        expect(r.isError).toBe(false);
        expect(r.text).toMatch(/shell exited during this call/i);
        expect(r.text).not.toMatch(/has been disposed/);
    });
    it('auto-respawns the shell when it has died between calls', async () => {
        const id = await createSession(harness.client, { label: 'will-die' });
        await call(harness.client, 'terminal_type', {
            sessionId: id,
            text: 'exit\n',
            idleMs: 250,
            maxWaitMs: 3000
        });
        await new Promise(r => setTimeout(r, 800));
        const r = await call(harness.client, 'terminal_type', {
            sessionId: id,
            text: 'echo after-respawn\n',
            idleMs: 200,
            maxWaitMs: 2000
        });
        expect(r.isError).toBe(true);
        expect(r.text).toMatch(/Session \d+ \("will-die"\)'s shell exited/);
        expect(r.text).toMatch(/fresh shell has been spawned/i);
        const r2 = await call(harness.client, 'terminal_type', {
            sessionId: id,
            text: 'echo after-respawn-2\n',
            idleMs: 250,
            maxWaitMs: 3000
        });
        expect(r2.isError).toBe(false);
        const read = await call(harness.client, 'terminal_read', { sessionId: id });
        expect(read.text).toMatch(/after-respawn-2/);
    });
    it('paginated read returns earlier window', async () => {
        const id = await createSession(harness.client);
        await call(harness.client, 'terminal_type', {
            sessionId: id,
            text: 'i=1; while [ $i -le 150 ]; do echo line$i; i=$((i+1)); done\n',
            idleMs: 500,
            maxWaitMs: 6000
        });
        const page0 = await call(harness.client, 'terminal_read', { sessionId: id, rows: 30, page: 0 });
        const page2 = await call(harness.client, 'terminal_read', { sessionId: id, rows: 30, page: 2 });
        expect(page0.text).toMatch(/line150|line149|line148/);
        expect(page2.text).not.toMatch(/line150/);
        expect(page2.text).toMatch(/line\d+/);
    });
});
//# sourceMappingURL=e2e.test.js.map