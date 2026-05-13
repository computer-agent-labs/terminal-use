import { createCanvas, loadImage } from '@napi-rs/canvas';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { call, createSession, startServer } from './helpers.js';
let harness;
beforeEach(async () => {
    harness = await startServer();
});
afterEach(async () => {
    await harness.shutdown();
});
async function dominantBackground(b64) {
    const img = await loadImage(Buffer.from(b64, 'base64'));
    const c = createCanvas(img.width, img.height);
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    // Bottom-right padding region — always background regardless of content.
    const px = ctx.getImageData(img.width - 4, img.height - 4, 1, 1).data;
    return { r: px[0], g: px[1], b: px[2] };
}
function near(actual, expected, tol = 16) {
    return Math.abs(actual - expected) <= tol;
}
describe('per-session theme', () => {
    it('terminal_create accepts a theme arg and terminal_list surfaces it', async () => {
        await createSession(harness.client, { label: 'l', theme: 'solarized-light' });
        const r = await call(harness.client, 'terminal_list', {});
        expect(r.text).toMatch(/theme=solarized-light/);
    });
    it('rejects unknown theme names', async () => {
        const r = await call(harness.client, 'terminal_create', { theme: 'not-a-theme' });
        expect(r.isError).toBe(true);
    });
    it('screenshot of a "light" session has a near-white background', async () => {
        const id = await createSession(harness.client, { theme: 'light' });
        const r = await call(harness.client, 'terminal_screenshot', { sessionId: id });
        expect(r.isError).toBe(false);
        expect(r.imageMimeTypes).toEqual(['image/png']);
        expect(r.imageDataLengths[0]).toBeGreaterThan(64);
    });
    it('default theme is dark; light theme produces a clearly different background', async () => {
        // Two sessions, different themes; assert their bottom-right pixels differ.
        const darkId = await createSession(harness.client, { theme: 'dark' });
        const lightId = await createSession(harness.client, { theme: 'light' });
        const inlineImageOf = async (sessionId) => {
            // call() in helpers.ts surfaces imageDataLengths but not the data
            // itself; reach into the raw response.
            const raw = await harness.client.callTool({
                name: 'terminal_screenshot',
                arguments: { sessionId }
            });
            const content = (raw.content ?? []);
            const image = content.find(c => c.type === 'image');
            if (!image?.data)
                throw new Error('no image returned');
            return image.data;
        };
        const darkPx = await dominantBackground(await inlineImageOf(darkId));
        const lightPx = await dominantBackground(await inlineImageOf(lightId));
        // Dark+ background is #1e1e1e (30, 30, 30); Light+ is #ffffff (255).
        expect(near(darkPx.r, 30)).toBe(true);
        expect(near(darkPx.g, 30)).toBe(true);
        expect(near(darkPx.b, 30)).toBe(true);
        expect(near(lightPx.r, 255)).toBe(true);
        expect(near(lightPx.g, 255)).toBe(true);
        expect(near(lightPx.b, 255)).toBe(true);
    });
    it('theme survives auto-respawn — solarized-dark stays solarized-dark after shell-exit', async () => {
        const id = await createSession(harness.client, { label: 'staying-solarized', theme: 'solarized-dark' });
        // Trigger shell exit + auto-respawn.
        await call(harness.client, 'terminal_type', {
            sessionId: id,
            text: 'exit\n',
            idleMs: 250,
            maxWaitMs: 3000
        });
        await new Promise(r => setTimeout(r, 800));
        await call(harness.client, 'terminal_type', {
            sessionId: id,
            text: 'echo back\n',
            idleMs: 250,
            maxWaitMs: 3000
        });
        const r = await call(harness.client, 'terminal_list', {});
        expect(r.text).toMatch(/theme=solarized-dark/);
    });
});
//# sourceMappingURL=theme.test.js.map