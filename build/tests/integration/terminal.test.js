import { describe, expect, it } from 'vitest';
import { bufferState, createTerminal, writeAndFlush } from '../../src/emulator/terminal.js';
describe('emulator terminal', () => {
    it('writes plain text into the buffer', async () => {
        const term = createTerminal({ cols: 40, rows: 10 });
        await writeAndFlush(term, 'hello world');
        const line = term.buffer.active.getLine(0);
        expect(line?.translateToString(true)).toBe('hello world');
        term.dispose();
    });
    it('interprets CSI cursor moves', async () => {
        const term = createTerminal({ cols: 40, rows: 10 });
        await writeAndFlush(term, 'aaa\r\n');
        await writeAndFlush(term, 'bbb\r\n');
        expect(term.buffer.active.getLine(0)?.translateToString(true)).toBe('aaa');
        expect(term.buffer.active.getLine(1)?.translateToString(true)).toBe('bbb');
        term.dispose();
    });
    it('parses ANSI palette colors', async () => {
        const term = createTerminal({ cols: 40, rows: 10 });
        await writeAndFlush(term, '\x1b[31mR\x1b[32mG\x1b[34mB\x1b[0m');
        const line = term.buffer.active.getLine(0);
        const c0 = line.getCell(0);
        const c1 = line.getCell(1);
        const c2 = line.getCell(2);
        expect(c0.getChars()).toBe('R');
        expect(c0.isFgPalette()).toBe(true);
        expect(c0.getFgColor()).toBe(1);
        expect(c1.getFgColor()).toBe(2);
        expect(c2.getFgColor()).toBe(4);
        term.dispose();
    });
    it('switches to alt buffer on ?1049h', async () => {
        const term = createTerminal({ cols: 40, rows: 10 });
        await writeAndFlush(term, 'normal\r\n');
        expect(term.buffer.active.type).toBe('normal');
        await writeAndFlush(term, '\x1b[?1049h\x1b[H');
        expect(term.buffer.active.type).toBe('alternate');
        await writeAndFlush(term, 'tui');
        const altLines = [];
        for (let y = 0; y < term.rows; y++) {
            altLines.push(term.buffer.active.getLine(y)?.translateToString(true) ?? '');
        }
        expect(altLines.some(line => line.includes('tui'))).toBe(true);
        await writeAndFlush(term, '\x1b[?1049l');
        expect(term.buffer.active.type).toBe('normal');
        expect(term.buffer.active.getLine(0)?.translateToString(true)).toBe('normal');
        term.dispose();
    });
    it('bufferState reports cursor and viewport', async () => {
        const term = createTerminal({ cols: 40, rows: 10 });
        await writeAndFlush(term, 'abc');
        const s = bufferState(term);
        expect(s.cols).toBe(40);
        expect(s.rows).toBe(10);
        expect(s.cursorRow).toBe(0);
        expect(s.cursorCol).toBe(3);
        expect(s.isAlt).toBe(false);
        term.dispose();
    });
});
//# sourceMappingURL=terminal.test.js.map