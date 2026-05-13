export const DARK_PLUS = {
    background: '#1e1e1e',
    foreground: '#cccccc',
    cursor: '#ffffff',
    ansi: [
        '#000000',
        '#cd3131',
        '#0dbc79',
        '#e5e510',
        '#2472c8',
        '#bc3fbc',
        '#11a8cd',
        '#e5e5e5',
        '#666666',
        '#f14c4c',
        '#23d18b',
        '#f5f543',
        '#3b8eea',
        '#d670d6',
        '#29b8db',
        '#ffffff'
    ]
};
export const LIGHT_PLUS = {
    background: '#ffffff',
    foreground: '#333333',
    cursor: '#333333',
    ansi: [
        '#000000',
        '#cd3131',
        '#00bc00',
        '#949800',
        '#0451a5',
        '#bc05bc',
        '#0598bc',
        '#555555',
        '#666666',
        '#cd3131',
        '#14ce14',
        '#b5ba00',
        '#0451a5',
        '#bc05bc',
        '#0598bc',
        '#a5a5a5'
    ]
};
// Standard Solarized palette per ethanschoonover.com/solarized.
// base03..base0 (dark): bg + content tones. base2..base3 (light): inverse.
const SOLARIZED_ACCENTS = {
    yellow: '#b58900',
    orange: '#cb4b16',
    red: '#dc322f',
    magenta: '#d33682',
    violet: '#6c71c4',
    blue: '#268bd2',
    cyan: '#2aa198',
    green: '#859900'
};
export const SOLARIZED_DARK = {
    background: '#002b36',
    foreground: '#839496',
    cursor: '#93a1a1',
    ansi: [
        '#073642',
        SOLARIZED_ACCENTS.red,
        SOLARIZED_ACCENTS.green,
        SOLARIZED_ACCENTS.yellow,
        SOLARIZED_ACCENTS.blue,
        SOLARIZED_ACCENTS.magenta,
        SOLARIZED_ACCENTS.cyan,
        '#eee8d5',
        '#002b36',
        SOLARIZED_ACCENTS.orange,
        '#586e75',
        '#657b83',
        '#839496',
        SOLARIZED_ACCENTS.violet,
        '#93a1a1',
        '#fdf6e3'
    ]
};
export const SOLARIZED_LIGHT = {
    background: '#fdf6e3',
    foreground: '#657b83',
    cursor: '#586e75',
    ansi: SOLARIZED_DARK.ansi
};
export const THEMES = {
    dark: DARK_PLUS,
    light: LIGHT_PLUS,
    'solarized-dark': SOLARIZED_DARK,
    'solarized-light': SOLARIZED_LIGHT
};
export const DEFAULT_THEME_NAME = 'dark';
const CUBE_LEVELS = [0, 95, 135, 175, 215, 255];
function paletteIndexToHex(theme, idx) {
    if (idx < 0 || idx > 255)
        return theme.foreground;
    if (idx < 16)
        return theme.ansi[idx];
    if (idx < 232) {
        const offset = idx - 16;
        const r = Math.floor(offset / 36);
        const g = Math.floor((offset % 36) / 6);
        const b = offset % 6;
        return rgbToHex(CUBE_LEVELS[r], CUBE_LEVELS[g], CUBE_LEVELS[b]);
    }
    const v = 8 + (idx - 232) * 10;
    return rgbToHex(v, v, v);
}
function rgbToHex(r, g, b) {
    const h = (n) => n.toString(16).padStart(2, '0');
    return `#${h(r)}${h(g)}${h(b)}`;
}
export function packedRgbToHex(packed) {
    const r = (packed >> 16) & 0xff;
    const g = (packed >> 8) & 0xff;
    const b = packed & 0xff;
    return rgbToHex(r, g, b);
}
export function resolveCellColors(cell, theme) {
    let fg;
    let bg;
    if (cell.isFgDefault())
        fg = theme.foreground;
    else if (cell.isFgRGB())
        fg = packedRgbToHex(cell.getFgColor());
    else if (cell.isFgPalette())
        fg = paletteIndexToHex(theme, cell.getFgColor());
    else
        fg = theme.foreground;
    if (cell.isBgDefault())
        bg = theme.background;
    else if (cell.isBgRGB())
        bg = packedRgbToHex(cell.getBgColor());
    else if (cell.isBgPalette())
        bg = paletteIndexToHex(theme, cell.getBgColor());
    else
        bg = theme.background;
    if (cell.isInverse()) {
        const tmp = fg;
        fg = bg;
        bg = tmp;
    }
    if (cell.isInvisible()) {
        fg = bg;
    }
    return { fg, bg };
}
export { paletteIndexToHex };
//# sourceMappingURL=palette.js.map