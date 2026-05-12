/**
 * Encode a left-mouse-button press+release at (col, row) using SGR-encoded
 * mouse events (CSI ?1006h protocol). col and row are 1-indexed.
 *
 *   `\x1b[<0;COL;ROW M`  press   (button 0 = left, no modifiers)
 *   `\x1b[<0;COL;ROW m`  release
 *
 * SGR encoding has no 223-cell ceiling and is what every modern TUI that
 * opts into mouse mode also negotiates. We send press+release atomically
 * because some TUIs only react to release.
 */
export function leftClickSequence(col: number, row: number): string {
  return `\x1b[<0;${col};${row}M\x1b[<0;${col};${row}m`
}
