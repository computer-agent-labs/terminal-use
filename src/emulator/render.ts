import {existsSync} from 'node:fs'
import {dirname, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

import {createCanvas, GlobalFonts} from '@napi-rs/canvas'
import type {Terminal} from '@xterm/headless'

import {DARK_PLUS, resolveCellColors, type ThemeColors} from './palette.js'

const FONT_FAMILY = 'JBMono'
const FONT_FAMILY_BOLD = 'JBMonoBold'

// System font fallbacks for glyphs JetBrains Mono lacks. @napi-rs/canvas
// only falls back among fonts we register explicitly — it does NOT scan
// system font dirs the way a real terminal does. Bundling Noto would add
// ~10MB+ per script, so on macOS we lean on system fonts instead (first
// existing candidate per family wins). Linux/Docker has none of these,
// so those glyphs render as the tofu missing-glyph box there — but
// terminal_read returns the real codepoints faithfully (see README).
const SYSTEM_FALLBACKS = [
  {
    // Color emoji: 🎉🚀✨ — also keyed on by the wide-cell downscale below.
    family: 'AppleEmoji',
    candidates: ['/System/Library/Fonts/Apple Color Emoji.ttc']
  },
  {
    // CJK: kana + Han, incl. kaomoji like ¯\_(ツ)_/¯ (ツ is U+30C4).
    family: 'CJKFallback',
    candidates: [
      '/System/Library/Fonts/Hiragino Sans GB.ttc',
      '/System/Library/Fonts/PingFang.ttc',
      '/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc'
    ]
  },
  {
    // Hangul — the Hiragino/PingFang families above don't cover it.
    family: 'HangulFallback',
    candidates: ['/System/Library/Fonts/AppleSDGothicNeo.ttc']
  }
]
const registeredFallbacks: string[] = []

export interface RenderOptions {
  page?: number
  fontSize?: number
  padding?: number
  theme?: ThemeColors
  drawCursor?: boolean
  /**
   * If set, draw a bright magenta ring around the cell at this 1-indexed
   * (col, row). Used by terminal_click's preview mode so the agent can
   * visually confirm where a click would land before committing.
   */
  clickMarker?: {col: number; row: number}
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
  if (process.platform === 'darwin') {
    for (const {family, candidates} of SYSTEM_FALLBACKS) {
      for (const path of candidates) {
        if (!existsSync(path)) continue
        try {
          if (GlobalFonts.registerFromPath(path, family) !== null) {
            registeredFallbacks.push(family)
            break
          }
        } catch {
          // System font may be locked down on some macOS configs — try
          // the next candidate, then fall through and those glyphs just
          // render as tofu (matching non-darwin behavior).
        }
      }
    }
  }
  fontsRegistered = true
}

function fontStack(primary: string): string {
  // Primary mono first so ASCII/Latin always uses JBMono, then the
  // fallbacks for codepoints it lacks. canvas walks the list per-glyph,
  // picking the first family that has the glyph.
  return [primary, ...registeredFallbacks].map(f => `"${f}"`).join(', ')
}

// Distinguish emoji from CJK among width-2 cells: color emoji live in
// the supplementary planes (U+1F000+) or carry the VS16 emoji-presentation
// selector on a BMP base (e.g. ❤️ = U+2764 U+FE0F). Everything else wide
// (kana, Han, Hangul, full-width forms) is text and should render
// full-size via the CJK fallback font.
function isEmojiCell(chars: string): boolean {
  const cp = chars.codePointAt(0) ?? 0
  return cp >= 0x1f000 || chars.includes('\ufe0f')
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
      // Width-2 emoji cells get drawn at 80% font size and centered
      // horizontally in the 2-cell slot. Without this, an emoji whose
      // em-square equals the 2-cell width visually butts up against the
      // following character — real terminals get breathing room from the
      // font's natural padding + their default downscaling of emoji vs.
      // monospace text. We mimic that. CJK glyphs are different: their
      // em-square has padding designed in and real terminals draw them
      // full-size, so wide non-emoji cells keep fontSize. Both Apple
      // Color Emoji and full-width CJK glyphs advance ~1em at any size,
      // so we can derive dx without a per-cell measureText() call.
      const isWide = cellWidth >= 2
      const isEmoji = isWide && isEmojiCell(ch)
      const glyphFontSize = isEmoji ? Math.round(fontSize * 0.8) : fontSize
      const glyphDx = isWide ? Math.round((drawW - glyphFontSize) / 2) : 0
      // Append the emoji fallback so cells holding emoji codepoints (which
      // JBMono lacks) get rendered via Apple Color Emoji on macOS. The
      // fallback is a no-op on Linux/Docker — emoji cells stay tofu there.
      ctx.font = `${style}${glyphFontSize}px ${fontStack(family)}`
      ctx.fillStyle = colors.fg
      if (cell.isDim() !== 0) {
        ctx.globalAlpha = 0.6
      }
      ctx.fillText(ch, x + glyphDx, yPx + metrics.baselineOffset)
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

  if (options.clickMarker) {
    drawClickMarker(ctx, options.clickMarker, metrics, padding, cols, rows)
  }

  return {
    buffer: canvas.toBuffer('image/png'),
    width,
    height
  }
}

function drawClickMarker(
  ctx: ReturnType<ReturnType<typeof createCanvas>['getContext']>,
  marker: {col: number; row: number},
  metrics: Metrics,
  padding: number,
  cols: number,
  rows: number
): void {
  // Coordinates from the agent are 1-indexed. Clamp to the visible viewport.
  const col = Math.max(1, Math.min(cols, marker.col))
  const row = Math.max(1, Math.min(rows, marker.row))
  const cx = padding + (col - 0.5) * metrics.cellWidth
  const cy = padding + (row - 0.5) * metrics.cellHeight
  const radius = Math.max(metrics.cellWidth, metrics.cellHeight) * 1.4

  // Outer dark halo so the ring stays visible on bright cells.
  ctx.strokeStyle = '#000000'
  ctx.lineWidth = 6
  ctx.beginPath()
  ctx.arc(cx, cy, radius, 0, Math.PI * 2)
  ctx.stroke()

  // Bright magenta ring.
  ctx.strokeStyle = '#ff00ff'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.arc(cx, cy, radius, 0, Math.PI * 2)
  ctx.stroke()

  // Small filled dot at the exact target cell center.
  ctx.fillStyle = '#ff00ff'
  ctx.fillRect(cx - 2, cy - 2, 4, 4)

  // Coordinate label off to the side with a dark stroke for legibility.
  const label = `(col ${col}, row ${row})`
  ctx.font = `${Math.round(metrics.fontSize * 0.85)}px "JBMonoBold"`
  ctx.textBaseline = 'alphabetic'
  const labelX = cx + radius + 6
  const labelY = cy - radius * 0.4
  ctx.strokeStyle = '#000000'
  ctx.lineWidth = 4
  ctx.strokeText(label, labelX, labelY)
  ctx.fillStyle = '#ff00ff'
  ctx.fillText(label, labelX, labelY)
}
