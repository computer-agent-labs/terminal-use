import { describe, expect, it } from 'vitest';
import { leftClickSequence } from '../../src/pty/mouse.js';
describe('leftClickSequence', () => {
    it('produces the SGR press+release pair for left button at the given cell', () => {
        expect(leftClickSequence(5, 10)).toBe('\x1b[<0;5;10M\x1b[<0;5;10m');
    });
    it('emits 1-indexed coordinates verbatim (no off-by-one)', () => {
        expect(leftClickSequence(1, 1)).toBe('\x1b[<0;1;1M\x1b[<0;1;1m');
    });
    it('handles large coordinates (SGR has no 223-cell ceiling)', () => {
        expect(leftClickSequence(500, 300)).toBe('\x1b[<0;500;300M\x1b[<0;500;300m');
    });
    it('press uses uppercase M, release uses lowercase m', () => {
        const seq = leftClickSequence(7, 3);
        const press = seq.slice(0, seq.indexOf('M') + 1);
        const release = seq.slice(seq.indexOf('M') + 1);
        expect(press.endsWith('M')).toBe(true);
        expect(release.endsWith('m')).toBe(true);
    });
});
//# sourceMappingURL=mouse.test.js.map