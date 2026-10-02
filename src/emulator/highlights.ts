import type {Terminal} from '@xterm/headless'

import {DARK_PLUS, resolveCellColors} from './palette.js'

/** A run of cells that stands out from the rest of the screen. */
export interface Highlight {
  /** 1-indexed screen row, as terminal_click counts them. */
  row: number
  /** 1-indexed first and last cell column of the run. */
  startCol: number
  endCol: number
  text: string
}

export interface Highlights {
  spans: Highlight[]
  /** Spans left out because there were more than the cap. */
  omitted: number
  /**
   * True when so much of the screen is styled that listing it would say
   * nothing (a program that paints panels everywhere) — a screenshot is the
   * right tool then.
   */
  dense: boolean
}

const MAX_SPANS = 20
const DENSE_FRACTION = 0.4

/**
 * Find what a program is drawing attention to. Plain text drops color, and
 * with it the one thing that says which menu entry, tab or button is
 * selected: TUIs show selection with reverse video or a background color.
 * So: take the most common effective background on screen as "the"
 * background, and report every run of text drawn on anything else.
 */
export function findHighlights(term: Terminal, firstRow: number, lastRow: number): Highlights {
  const buf = term.buffer.active
  const top = buf.baseY
  const from = Math.max(firstRow, top)
  const to = Math.min(lastRow, top + term.rows - 1)

  // Effective background per cell (reverse video already applied by
  // resolveCellColors). The theme only has to be consistent, not the
  // session's own — we compare backgrounds with each other.
  const rows: Array<Array<{bg: string; chars: string; col: number}>> = []
  const counts = new Map<string, number>()
  let total = 0
  for (let y = from; y <= to; y++) {
    const line = buf.getLine(y)
    const cells: Array<{bg: string; chars: string; col: number}> = []
    if (line) {
      for (let x = 0; x < term.cols; x++) {
        const cell = line.getCell(x)
        if (!cell || cell.getWidth() === 0) continue
        const bg = resolveCellColors(cell, DARK_PLUS).bg
        cells.push({bg, chars: cell.getChars() || ' ', col: x + 1})
        counts.set(bg, (counts.get(bg) ?? 0) + 1)
        total++
      }
    }
    rows.push(cells)
  }
  if (total === 0) return {spans: [], omitted: 0, dense: false}

  let dominant = ''
  let dominantCount = -1
  for (const [bg, n] of counts) {
    if (n > dominantCount) {
      dominant = bg
      dominantCount = n
    }
  }
  if (total - dominantCount > total * DENSE_FRACTION) return {spans: [], omitted: 0, dense: true}

  const spans: Highlight[] = []
  rows.forEach((cells, i) => {
    let run: {bg: string; text: string; startCol: number; endCol: number} | undefined
    const close = () => {
      // A colored bar with nothing written on it is decoration, not a selection.
      if (run && run.text.trim() !== '') {
        spans.push({row: from + i - top + 1, startCol: run.startCol, endCol: run.endCol, text: run.text.trim()})
      }
      run = undefined
    }
    for (const cell of cells) {
      if (cell.bg === dominant) {
        close()
        continue
      }
      if (run && (run.bg !== cell.bg || cell.col !== run.endCol + 1)) close()
      if (!run) run = {bg: cell.bg, text: '', startCol: cell.col, endCol: cell.col}
      run.text += cell.chars
      // A wide character occupies this column and the next.
      run.endCol = cell.col + (cell.chars.length > 0 && isWide(term, from + i, cell.col - 1) ? 1 : 0)
    }
    close()
  })
  return {spans: spans.slice(0, MAX_SPANS), omitted: Math.max(0, spans.length - MAX_SPANS), dense: false}
}

function isWide(term: Terminal, y: number, x: number): boolean {
  return term.buffer.active.getLine(y)?.getCell(x)?.getWidth() === 2
}
