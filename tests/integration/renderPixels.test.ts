import {createCanvas, loadImage} from '@napi-rs/canvas'
import {describe, expect, it} from 'vitest'

import {DARK_PLUS} from '../../src/emulator/palette.js'
import {renderToPng, type RenderResult} from '../../src/emulator/render.js'
import {createTerminal, writeAndFlush} from '../../src/emulator/terminal.js'

interface RGBA {
  r: number
  g: number
  b: number
  a: number
}

async function decodePixel(result: RenderResult, x: number, y: number): Promise<RGBA> {
  const img = await loadImage(result.buffer)
  const c = createCanvas(img.width, img.height)
  const ctx = c.getContext('2d')
  ctx.drawImage(img, 0, 0)
  const data = ctx.getImageData(x, y, 1, 1).data
  return {r: data[0]!, g: data[1]!, b: data[2]!, a: data[3]!}
}

function hexToRgb(hex: string): {r: number; g: number; b: number} {
  const v = hex.replace('#', '')
  return {
    r: parseInt(v.slice(0, 2), 16),
    g: parseInt(v.slice(2, 4), 16),
    b: parseInt(v.slice(4, 6), 16)
  }
}

function near(actual: number, expected: number, tolerance = 30): boolean {
  return Math.abs(actual - expected) <= tolerance
}

describe('renderer pixel-level regression', () => {
  it('background pixels match the theme background color', async () => {
    const term = createTerminal({cols: 20, rows: 5})
    const result = renderToPng(term)
    const expected = hexToRgb(DARK_PLUS.background)
    // Top-left padding area is always background.
    const px = await decodePixel(result, 2, 2)
    expect(near(px.r, expected.r)).toBe(true)
    expect(near(px.g, expected.g)).toBe(true)
    expect(near(px.b, expected.b)).toBe(true)
    term.dispose()
  })

  it('a red glyph cell renders predominantly red pixels', async () => {
    const term = createTerminal({cols: 20, rows: 5})
    await writeAndFlush(term, '\x1b[31mRRRRR\x1b[0m')
    const result = renderToPng(term)
    // Sample a vertical strip across the first cell. We expect at least one
    // glyph pixel where R is the dominant channel by a clear margin.
    let foundRed = false
    for (let dx = 0; dx < 8; dx++) {
      for (let dy = 0; dy < 16; dy++) {
        const px = await decodePixel(result, 8 + dx, 8 + dy)
        if (px.r > 120 && px.r > px.g + 50 && px.r > px.b + 50) {
          foundRed = true
        }
      }
    }
    expect(foundRed).toBe(true)
    term.dispose()
  })

  it('a green glyph cell renders predominantly green pixels', async () => {
    const term = createTerminal({cols: 20, rows: 5})
    await writeAndFlush(term, '\x1b[32mGGGGG\x1b[0m')
    const result = renderToPng(term)
    let foundGreen = false
    for (let dx = 0; dx < 8; dx++) {
      for (let dy = 0; dy < 16; dy++) {
        const px = await decodePixel(result, 8 + dx, 8 + dy)
        if (px.g > 120 && px.g > px.r + 50 && px.g > px.b + 30) {
          foundGreen = true
        }
      }
    }
    expect(foundGreen).toBe(true)
    term.dispose()
  })

  it('a red-bg cell paints background red across the cell', async () => {
    const term = createTerminal({cols: 20, rows: 5})
    await writeAndFlush(term, '\x1b[41m   \x1b[0m')
    const result = renderToPng(term)
    // Spaces have the bg color across the entire cell, including the empty
    // top of the cell where the glyph wouldn't reach.
    const px = await decodePixel(result, 8 + 3, 8 + 1)
    expect(px.r).toBeGreaterThan(150)
    expect(px.g).toBeLessThan(90)
    expect(px.b).toBeLessThan(90)
    term.dispose()
  })

  it('output is deterministic — same buffer produces identical bytes', async () => {
    const term = createTerminal({cols: 20, rows: 5})
    await writeAndFlush(term, 'hello \x1b[1;33mworld\x1b[0m')
    const r1 = renderToPng(term)
    const r2 = renderToPng(term)
    expect(r1.buffer.equals(r2.buffer)).toBe(true)
    term.dispose()
  })
})

// macOS and Windows always ship a color-emoji font; Linux only with the
// optional Noto package, which the CI image does not have.
describe.runIf(process.platform === 'darwin' || process.platform === 'win32')('system font fallback', () => {
  it('draws emoji in color, from the system emoji font', async () => {
    const term = createTerminal({cols: 10, rows: 3})
    await writeAndFlush(term, '\u{1F389}')
    const result = renderToPng(term, {fontSize: 32, drawCursor: false})
    const img = await loadImage(result.buffer)
    const c = createCanvas(img.width, img.height)
    const ctx = c.getContext('2d')
    ctx.drawImage(img, 0, 0)
    const {data} = ctx.getImageData(0, 0, Math.min(img.width, 80), Math.min(img.height, 60))
    // The missing-glyph box and plain text are drawn in the gray foreground
    // color. Strongly saturated pixels can only come from a color glyph.
    let saturated = 0
    for (let i = 0; i < data.length; i += 4) {
      const max = Math.max(data[i]!, data[i + 1]!, data[i + 2]!)
      const min = Math.min(data[i]!, data[i + 1]!, data[i + 2]!)
      if (max - min > 90) saturated++
    }
    expect(saturated).toBeGreaterThan(20)
    term.dispose()
  })
})

