import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { call, createSession, startServer } from './helpers.js';
let harness;
beforeEach(async () => {
    harness = await startServer();
});
afterEach(async () => {
    await harness.shutdown();
});
describe('multi-session', () => {
    it('terminal_create returns a fresh sessionId and includes label when provided', async () => {
        const r = await call(harness.client, 'terminal_create', { label: 'first' });
        expect(r.isError).toBe(false);
        expect(r.text).toMatch(/Created session 1.*"first"/);
        expect(r.text).toMatch(/\[1 \("first"\)\]/);
    });
    it('two terminal_create calls return distinct ids and both show in terminal_list', async () => {
        const idA = await createSession(harness.client, { label: 'a' });
        const idB = await createSession(harness.client, { label: 'b' });
        expect(idA).not.toBe(idB);
        const listed = await call(harness.client, 'terminal_list', {});
        expect(listed.text).toMatch(/2 live session/);
        expect(listed.text).toMatch(new RegExp(`\\[${idA} \\("a"\\)\\]`));
        expect(listed.text).toMatch(new RegExp(`\\[${idB} \\("b"\\)\\]`));
    });
    it('typing into specific sessionIds keeps state independent', async () => {
        const idA = await createSession(harness.client, { label: 'a' });
        const idB = await createSession(harness.client, { label: 'b' });
        await call(harness.client, 'terminal_type', {
            sessionId: idA,
            text: 'echo only-in-a\n',
            idleMs: 250,
            maxWaitMs: 3000
        });
        await call(harness.client, 'terminal_type', {
            sessionId: idB,
            text: 'echo only-in-b\n',
            idleMs: 250,
            maxWaitMs: 3000
        });
        const readA = await call(harness.client, 'terminal_read', { sessionId: idA });
        expect(readA.text).toMatch(/only-in-a/);
        expect(readA.text).not.toMatch(/only-in-b/);
        const readB = await call(harness.client, 'terminal_read', { sessionId: idB });
        expect(readB.text).toMatch(/only-in-b/);
        expect(readB.text).not.toMatch(/only-in-a/);
    });
    it('targeting an unknown sessionId surfaces a clean error', async () => {
        const r = await call(harness.client, 'terminal_type', {
            sessionId: 999,
            text: 'echo no\n'
        });
        expect(r.isError).toBe(true);
        expect(r.text).toMatch(/Unknown sessionId 999/);
    });
    it('terminal_destroy removes the session entirely (no tombstone)', async () => {
        const idA = await createSession(harness.client, { label: 'a' });
        const destroyed = await call(harness.client, 'terminal_destroy', { sessionId: idA });
        expect(destroyed.isError).toBe(false);
        expect(destroyed.text).toMatch(`Destroyed session ${idA}`);
        // Subsequent call against destroyed id is a hard error — no auto-respawn.
        const ghost = await call(harness.client, 'terminal_read', { sessionId: idA });
        expect(ghost.isError).toBe(true);
        expect(ghost.text).toMatch(`Unknown sessionId ${idA}`);
    });
    it('per-session state survives across multiple resize/reset/screenshot calls on a non-default id', async () => {
        const idA = await createSession(harness.client);
        const idB = await createSession(harness.client);
        // Resize only B.
        const resize = await call(harness.client, 'terminal_resize', { sessionId: idB, cols: 60, rows: 18 });
        expect(resize.text).toMatch(/60x18/);
        // A's size unchanged (default 120x30).
        const readA = await call(harness.client, 'terminal_read', { sessionId: idA });
        expect(readA.text).toMatch(/120x30/);
        // hardReset on B preserves its (resized) shape if no override given.
        const hard = await call(harness.client, 'terminal_reset', { sessionId: idB, hardReset: true });
        expect(hard.text).toMatch(/Hard reset/);
        // Screenshot on each works independently.
        const shotA = await call(harness.client, 'terminal_screenshot', { sessionId: idA });
        const shotB = await call(harness.client, 'terminal_screenshot', { sessionId: idB });
        expect(shotA.imageMimeTypes).toEqual(['image/png']);
        expect(shotB.imageMimeTypes).toEqual(['image/png']);
    });
    it('auto-respawn keeps the same sessionId and includes the label in the notice', async () => {
        const idA = await createSession(harness.client, { label: 'will-die' });
        await call(harness.client, 'terminal_type', {
            sessionId: idA,
            text: 'exit\n',
            idleMs: 250,
            maxWaitMs: 3000
        });
        await new Promise(r => setTimeout(r, 800));
        const r = await call(harness.client, 'terminal_type', {
            sessionId: idA,
            text: 'echo after\n',
            idleMs: 250,
            maxWaitMs: 3000
        });
        expect(r.isError).toBe(true);
        expect(r.text).toMatch(new RegExp(`Session ${idA} \\("will-die"\\)'s shell exited`));
        const listed = await call(harness.client, 'terminal_list', {});
        expect(listed.text).toMatch(new RegExp(`\\[${idA} \\("will-die"\\)\\]`));
    });
});
//# sourceMappingURL=multiSession.test.js.map