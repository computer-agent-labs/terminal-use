import { afterEach, describe, expect, it } from 'vitest';
import { TerminalSession } from '../../src/session/TerminalSession.js';
let active = null;
afterEach(() => {
    if (active) {
        active.dispose();
        active = null;
    }
});
describe('TerminalSession.read pagination', () => {
    it('paginates through 500 numbered lines from the bottom', async () => {
        active = new TerminalSession({ shell: '/bin/sh', cwd: process.cwd(), cols: 40, rows: 10 });
        const s = active;
        const N = 500;
        await s.writeText(`i=1; while [ $i -le ${N} ]; do echo line$i; i=$((i+1)); done\n`, { idleMs: 600, maxWaitMs: 8000 });
        const page0 = s.read(50, 0);
        expect(page0.window.totalPages).toBeGreaterThanOrEqual(10);
        expect(page0.state.bufferLength).toBeGreaterThanOrEqual(N);
        const lastNonEmpty = page0.text.filter(l => /^line\d+$/.test(l));
        expect(lastNonEmpty.length).toBeGreaterThan(0);
        expect(lastNonEmpty[lastNonEmpty.length - 1]).toBe(`line${N}`);
        const page1 = s.read(50, 1);
        const onlyLines = page1.text.filter(l => /^line\d+$/.test(l));
        if (onlyLines.length > 0) {
            const numbers = onlyLines.map(l => parseInt(l.slice(4), 10));
            const minNum = Math.min(...numbers);
            const maxNum = Math.max(...numbers);
            const recentMin = Math.min(...lastNonEmpty.map(l => parseInt(l.slice(4), 10)));
            expect(maxNum).toBeLessThan(recentMin);
            expect(maxNum - minNum).toBeLessThanOrEqual(50);
        }
        const wayPast = s.read(50, 9999);
        expect(wayPast.window.start).toBe(0);
        expect(wayPast.window.page).toBeLessThan(wayPast.window.totalPages);
    }, 30000);
    it('rows defaulting to screen height yields a screen of recent content', async () => {
        active = new TerminalSession({ shell: '/bin/sh', cwd: process.cwd(), cols: 40, rows: 12 });
        const s = active;
        await s.writeText("printf 'recent-marker\\n'\n", { idleMs: 250, maxWaitMs: 3000 });
        const win = s.read(s.term.rows, 0);
        expect(win.window.rows).toBe(12);
        expect(win.text.some(l => l.includes('recent-marker'))).toBe(true);
    });
});
//# sourceMappingURL=readPagination.test.js.map