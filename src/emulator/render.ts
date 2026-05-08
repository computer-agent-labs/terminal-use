import {existsSync} from 'node:fs'
import {dirname, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

import {createCanvas, GlobalFonts} from '@napi-rs/canvas'
import type {Terminal} from '@xterm/headless'

import {DARK_PLUS, resolveCellColors, type ThemeColors} from './palette.js'

const FONT_FAMILY = 'JBMono'
const FONT_FAMILY_BOLD = 'JBMonoBold'

export interface RenderOptions {
  page?: number
  fontSize?: number
  padding?: number
  theme?: ThemeColors
  drawCursor?: boolean
}

export interface RenderResult {
  buffer: Buffer
  width: number
  height: number
}

let fontsRegistered = false

function findFontDir(): string {
  const start = dirname(fileURLToPath(import.meta.url))
  let dir = start
  for (let i = 0; i < 8; i++) {
    const candidate = resolve(dir, 'fonts')
    if (
      existsSync(candidate) &&
      existsSync(resolve(candidate, 'JetBrainsMono-Regular.ttf'))
    ) {
      return candidate
    }
    const parent = resolve(dir, '..')
    if (parent === dir) break
    dir = parent
  }
  throw new Error(`Could not locate bundled fonts directory starting from ${start}`)
}

function ensureFonts(): void {
  if (fontsRegistered) return
  const fontDir = findFontDir()
  GlobalFonts.registerFromPath(
    resolve(fontDir, 'JetBrainsMono-Regular.ttf'),
    FONT_FAMILY
  )
  GlobalFonts.registerFromPath(
    resolve(fontDir, 'JetBrainsMono-Bold.ttf'),
    FONT_FAMILY_BOLD
  )
  fontsRegistered = true
}

interface Metrics {
  cellWidth: number
  cellHeight: number
  baselineOffset: number
  fontSize: number
}

function measureMetrics(fontSize: number): Metrics {
  ensureFonts()
  const probe = createCanvas(8, 8)
  const ctx = probe.getContext('2d')
  ctx.font = `${fontSize}px "${FONT_FAMILY}"`
  const m = ctx.measureText('M')
  const cellWidth = Math.round(m.width)
  const cellHeight = Math.round(fontSize * 1.25)
  const ascent =
    typeof m.actualBoundingBoxAscent === 'number' ? m.actualBoundingBoxAscent : fontSize * 0.85
  return {
    cellWidth: Math.max(cellWidth, Math.round(fontSize * 0.55)),
    cellHeight,
    baselineOffset: Math.round((cellHeight - fontSize) / 2 + ascent),
    fontSize
  }
}

export function renderToPng(term: Terminal, options: RenderOptions = {}): RenderResult {
  ensureFonts()
  const fontSize = options.fontSize ?? 14
  const padding = options.padding ?? 8
  const theme = options.theme ?? DARK_PLUS
  const page = Math.max(0, options.page ?? 0)
  const drawCursor = options.drawCursor ?? true

  const buf = term.buffer.active
  const rows = term.rows
  const cols = term.cols
  const lastIndex = Math.max(0, buf.length - 1)
  let end = lastIndex - page * rows
  if (end < 0) end = 0
  let start = end - rows + 1
  if (start < 0) start = 0

  const metrics = measureMetrics(fontSize)
  const width = metrics.cellWidth * cols + padding * 2
  const height = metrics.cellHeight * rows + padding * 2

  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')

  ctx.fillStyle = theme.background
  ctx.fillRect(0, 0, width, height)
  ctx.textBaseline = 'alphabetic'

  for (let row = 0; row < rows; row++) {
    const y = start + row
    if (y > end) break
    const line = buf.getLine(y)
    if (!line) continue
    for (let col = 0; col < cols; col++) {
      const cell = line.getCell(col)
      if (!cell) continue
      const cellWidth = cell.getWidth()
      if (cellWidth === 0) continue
      const ch = cell.getChars() || ' '
      const colors = resolveCellColors(cell, theme)
      const drawW = metrics.cellWidth * cellWidth
      const x = padding + col * metrics.cellWidth
      const yPx = padding + row * metrics.cellHeight

      if (colors.bg !== theme.background) {
        ctx.fillStyle = colors.bg
        ctx.fillRect(x, yPx, drawW, metrics.cellHeight)
      }

      if (cell.isInvisible()) continue

      const isBold = cell.isBold() !== 0
      const isItalic = cell.isItalic() !== 0
      const family = isBold ? FONT_FAMILY_BOLD : FONT_FAMILY
      const style = isItalic ? 'italic ' : ''
      ctx.font = `${style}${fontSize}px "${family}"`
      ctx.fillStyle = colors.fg
      if (cell.isDim() !== 0) {
        ctx.globalAlpha = 0.6
      }
      ctx.fillText(ch, x, yPx + metrics.baselineOffset)
      ctx.globalAlpha = 1

      if (cell.isUnderline() !== 0) {
        ctx.fillStyle = colors.fg
        ctx.fillRect(x, yPx + metrics.cellHeight - 2, drawW, 1)
      }
      if (cell.isStrikethrough() !== 0) {
        ctx.fillStyle = colors.fg
        ctx.fillRect(x, yPx + Math.floor(metrics.cellHeight / 2), drawW, 1)
      }
    }
  }

  if (drawCursor && page === 0) {
    const cursorRowAbs = buf.baseY + buf.cursorY
    if (cursorRowAbs >= start && cursorRowAbs <= end) {
      const cursorRowInWindow = cursorRowAbs - start
      const cx = padding + buf.cursorX * metrics.cellWidth
      const cy = padding + cursorRowInWindow * metrics.cellHeight
      ctx.fillStyle = theme.cursor
      ctx.globalAlpha = 0.6
      ctx.fillRect(cx, cy, metrics.cellWidth, metrics.cellHeight)
      ctx.globalAlpha = 1
    }
  }

  return {
    buffer: canvas.toBuffer('image/png'),
    width,
    height
  }
}
