import { describe, expect, it } from 'vitest';
import { totalPages, windowMath } from '../../src/emulator/pagination.js';
describe('totalPages', () => {
    it('clamps to 1 for zero or negative', () => {
        expect(totalPages(0, 50)).toBe(1);
        expect(totalPages(-5, 50)).toBe(1);
    });
    it('rounds up partial last page', () => {
        expect(totalPages(50, 50)).toBe(1);
        expect(totalPages(51, 50)).toBe(2);
        expect(totalPages(250, 100)).toBe(3);
        expect(totalPages(300, 100)).toBe(3);
        expect(totalPages(301, 100)).toBe(4);
    });
    it('handles invalid rows', () => {
        expect(totalPages(100, 0)).toBe(1);
        expect(totalPages(100, -1)).toBe(1);
    });
});
describe('windowMath', () => {
    it('empty buffer returns no rows', () => {
        const w = windowMath(0, 0, 24);
        expect(w.start).toBe(0);
        expect(w.end).toBe(-1);
        expect(w.totalPages).toBe(1);
    });
    it('page 0 returns the newest window', () => {
        const w = windowMath(100, 0, 24);
        expect(w.end).toBe(99);
        expect(w.start).toBe(76);
        expect(w.page).toBe(0);
    });
    it('page 1 returns the previous window', () => {
        const w = windowMath(100, 1, 24);
        expect(w.end).toBe(75);
        expect(w.start).toBe(52);
    });
    it('page past the top clamps to topmost window', () => {
        const w = windowMath(100, 999, 24);
        expect(w.start).toBe(0);
        expect(w.end).toBeLessThan(24);
        expect(w.page).toBeLessThanOrEqual(w.totalPages - 1);
    });
    it('rows greater than buffer length clamps start to 0', () => {
        const w = windowMath(10, 0, 100);
        expect(w.start).toBe(0);
        expect(w.end).toBe(9);
    });
    it('fractional last page returns only the real rows', () => {
        const total = totalPages(250, 100);
        expect(total).toBe(3);
        const w = windowMath(250, 2, 100);
        expect(w.start).toBe(0);
        expect(w.end).toBe(49);
    });
});
//# sourceMappingURL=pagination.test.js.map