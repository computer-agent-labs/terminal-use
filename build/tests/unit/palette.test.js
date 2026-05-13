import { describe, expect, it } from 'vitest';
import { DARK_PLUS, packedRgbToHex, paletteIndexToHex, resolveCellColors } from '../../src/emulator/palette.js';
describe('packedRgbToHex', () => {
    it('expands 0xRRGGBB into #rrggbb', () => {
        expect(packedRgbToHex(0xff0000)).toBe('#ff0000');
        expect(packedRgbToHex(0x00ff00)).toBe('#00ff00');
        expect(packedRgbToHex(0x123456)).toBe('#123456');
        expect(packedRgbToHex(0x000000)).toBe('#000000');
    });
});
describe('paletteIndexToHex', () => {
    it('returns the ANSI palette for 0..15', () => {
        for (let i = 0; i < 16; i++) {
            expect(paletteIndexToHex(DARK_PLUS, i)).toBe(DARK_PLUS.ansi[i]);
        }
    });
    it('decodes the 6x6x6 RGB cube (16..231)', () => {
        expect(paletteIndexToHex(DARK_PLUS, 16)).toBe('#000000');
        expect(paletteIndexToHex(DARK_PLUS, 231)).toBe('#ffffff');
        // index 16 + 36*1 + 6*2 + 3 = 67 → r=1(95), g=2(135), b=3(175)
        expect(paletteIndexToHex(DARK_PLUS, 67)).toBe('#5f87af');
    });
    it('decodes the grayscale ramp (232..255)', () => {
        expect(paletteIndexToHex(DARK_PLUS, 232)).toBe('#080808');
        expect(paletteIndexToHex(DARK_PLUS, 255)).toBe('#eeeeee');
    });
    it('falls back to foreground for out-of-range', () => {
        expect(paletteIndexToHex(DARK_PLUS, -1)).toBe(DARK_PLUS.foreground);
        expect(paletteIndexToHex(DARK_PLUS, 999)).toBe(DARK_PLUS.foreground);
    });
});
function cell(c) {
    const flag = (n) => (n ? 1 : 0);
    return {
        isFgDefault: () => c.fgDefault ?? false,
        isFgRGB: () => c.fgRGB ?? false,
        isFgPalette: () => c.fgPalette ?? false,
        getFgColor: () => c.fgValue ?? 0,
        isBgDefault: () => c.bgDefault ?? false,
        isBgRGB: () => c.bgRGB ?? false,
        isBgPalette: () => c.bgPalette ?? false,
        getBgColor: () => c.bgValue ?? 0,
        isInverse: () => flag(c.inverse),
        isBold: () => 0,
        isDim: () => 0,
        isInvisible: () => flag(c.invisible)
    };
}
describe('resolveCellColors', () => {
    it('default fg/bg fall back to theme', () => {
        const r = resolveCellColors(cell({ fgDefault: true, bgDefault: true }), DARK_PLUS);
        expect(r).toEqual({ fg: DARK_PLUS.foreground, bg: DARK_PLUS.background });
    });
    it('palette fg', () => {
        const r = resolveCellColors(cell({ fgPalette: true, fgValue: 1, bgDefault: true }), DARK_PLUS);
        expect(r.fg).toBe(DARK_PLUS.ansi[1]);
    });
    it('RGB fg', () => {
        const r = resolveCellColors(cell({ fgRGB: true, fgValue: 0xabcdef, bgDefault: true }), DARK_PLUS);
        expect(r.fg).toBe('#abcdef');
    });
    it('inverse swaps fg and bg', () => {
        const r = resolveCellColors(cell({ fgPalette: true, fgValue: 1, bgPalette: true, bgValue: 2, inverse: true }), DARK_PLUS);
        expect(r.fg).toBe(DARK_PLUS.ansi[2]);
        expect(r.bg).toBe(DARK_PLUS.ansi[1]);
    });
    it('invisible matches fg to bg', () => {
        const r = resolveCellColors(cell({ fgPalette: true, fgValue: 1, bgDefault: true, invisible: true }), DARK_PLUS);
        expect(r.fg).toBe(r.bg);
    });
});
//# sourceMappingURL=palette.test.js.map