import { describe, expect, it } from 'vitest';
import { renderToPng } from '../../src/emulator/render.js';
import { createTerminal, writeAndFlush } from '../../src/emulator/terminal.js';
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
describe('renderToPng', () => {
    it('emits a valid PNG', async () => {
        const term = createTerminal({ cols: 40, rows: 10 });
        await writeAndFlush(term, 'hello render\r\n');
        const result = renderToPng(term);
        expect(result.buffer.subarray(0, 8).equals(PNG_SIG)).toBe(true);
        expect(result.buffer.length).toBeGreaterThan(64);
        term.dispose();
    });
    it('width/height scale with cols/rows', () => {
        const small = createTerminal({ cols: 40, rows: 10 });
        const large = createTerminal({ cols: 80, rows: 20 });
        const r1 = renderToPng(small);
        const r2 = renderToPng(large);
        expect(r2.width).toBeGreaterThan(r1.width);
        expect(r2.height).toBeGreaterThan(r1.height);
        small.dispose();
        large.dispose();
    });
    it('renders without throwing for an empty buffer', () => {
        const term = createTerminal({ cols: 20, rows: 5 });
        const r = renderToPng(term);
        expect(r.buffer.length).toBeGreaterThan(64);
        term.dispose();
    });
    it('renders bold and colored cells without throwing', async () => {
        const term = createTerminal({ cols: 40, rows: 5 });
        await writeAndFlush(term, '\x1b[1;31mBOLD-RED\x1b[0m plain \x1b[4munderline\x1b[0m\r\n');
        const r = renderToPng(term);
        expect(r.buffer.subarray(0, 8).equals(PNG_SIG)).toBe(true);
        term.dispose();
    });
    it('renders wide chars without overdraw error', async () => {
        const term = createTerminal({ cols: 20, rows: 5 });
        await writeAndFlush(term, '你好世界\r\n');
        const r = renderToPng(term);
        expect(r.buffer.subarray(0, 8).equals(PNG_SIG)).toBe(true);
        term.dispose();
    });
    it('renders a different page from scrollback', async () => {
        const term = createTerminal({ cols: 20, rows: 5 });
        for (let i = 0; i < 50; i++) {
            await writeAndFlush(term, `line${i}\r\n`);
        }
        const recent = renderToPng(term, { page: 0 });
        const old = renderToPng(term, { page: 5 });
        expect(recent.buffer.length).toBeGreaterThan(64);
        expect(old.buffer.length).toBeGreaterThan(64);
        expect(recent.width).toBe(old.width);
        expect(recent.height).toBe(old.height);
        term.dispose();
    });
});
//# sourceMappingURL=render.test.js.map