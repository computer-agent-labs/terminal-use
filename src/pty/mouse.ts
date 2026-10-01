/**
 * Encode a left-mouse-button press+release at (col, row). col and row are
 * 1-indexed. Press + release are sent atomically because some TUIs only
 * react to release.
 *
 * SGR encoding (used when the program enabled CSI ?1006h — every modern TUI):
 *
 *   `\x1b[<0;COL;ROW M`  press   (button 0 = left, no modifiers)
 *   `\x1b[<0;COL;ROW m`  release
 *
 * Legacy X10/normal encoding (program enabled mouse tracking but not 1006):
 *
 *   `\x1b[M` + byte(32+button) + byte(32+COL) + byte(32+ROW), release = button 3
 *
 * Legacy coordinates are single bytes, and we write to the pty as UTF-8, so
 * only values that stay ASCII (col/row <= 95) can be addressed.
 */
export const LEGACY_MOUSE_MAX = 95

export function leftClickSequence(col: number, row: number, sgr = true): string {
  if (sgr) return `\x1b[<0;${col};${row}M\x1b[<0;${col};${row}m`
  if (col > LEGACY_MOUSE_MAX || row > LEGACY_MOUSE_MAX) {
    throw new Error(
      `The foreground program uses legacy mouse encoding, which cannot address (col ${col}, row ${row}) — ` +
        `the limit is ${LEGACY_MOUSE_MAX}. Use the keyboard for this target.`
    )
  }
  const xy = String.fromCharCode(32 + col) + String.fromCharCode(32 + row)
  return `\x1b[M${String.fromCharCode(32)}${xy}\x1b[M${String.fromCharCode(35)}${xy}`
}
