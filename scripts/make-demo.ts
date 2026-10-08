// Regenerates docs/demo.gif and docs/screenshot.png: a short session driven
// through the same code the MCP tools use, with every frame rendered by the
// project's own screenshot renderer. Nothing here is mocked.
//
//   yarn demo
//
// Needs `ffmpeg`, `vim` and `python3` on PATH. Runs in a throwaway directory
// with its own HOME, so nothing from your machine ends up in the picture.
import {execFileSync} from 'node:child_process'
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

import {createCanvas, loadImage} from '@napi-rs/canvas'

import {DARK_PLUS} from '../src/emulator/palette.js'
import {renderToPng} from '../src/emulator/render.js'
import {TerminalSession} from '../src/session/TerminalSession.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'docs')
const COLS = 72
const ROWS = 17
const FONT_SIZE = 18
const CAPTION_HEIGHT = 46
const FRAME_MS = 80

const PROGRAM = [
  'def fizzbuzz(n):',
  '    for i in range(1, n + 1):',
  '        if i % 15 == 0:',
  '            print("FizzBuzz")',
  '        elif i % 3 == 0:',
  '            print("Fizz")',
  '        elif i % 5 == 0:',
  '            print("Buzz")',
  '        else:',
  '            print(i)',
  '',
  'fizzbuzz(15)'
].join('\n')

const work = mkdtempSync(join(tmpdir(), 'terminal-use-demo-'))
const frames = join(work, 'frames')
mkdirSync(frames)
mkdirSync(OUT, {recursive: true})
// A minimal vimrc, so the demo shows syntax colors without typing options.
writeFileSync(join(work, '.vimrc'), 'syntax on\nset number\nset background=dark\nset noswapfile\nset shortmess+=I\n')

const session = new TerminalSession({
  cols: COLS,
  rows: ROWS,
  shell: '/bin/bash',
  cwd: work,
  env: {HOME: work, PS1: '\\[\\e[1;32m\\]~/project\\[\\e[0m\\] $ ', BASH_SILENCE_DEPRECATION_WARNING: '1'}
})

let frameCount = 0

/** Render the screen with a caption strip naming the tool call, and hold it for `ms`. */
async function shot(caption: string, ms: number): Promise<void> {
  await session.flush()
  const screen = renderToPng(session.term, {fontSize: FONT_SIZE, theme: DARK_PLUS})
  const image = await loadImage(screen.buffer)
  const canvas = createCanvas(screen.width, screen.height + CAPTION_HEIGHT)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#111111'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(image, 0, CAPTION_HEIGHT)
  ctx.fillStyle = '#2d2d2d'
  ctx.fillRect(0, CAPTION_HEIGHT - 1, canvas.width, 1)
  ctx.font = '15px "JBMonoBold"'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#d7ba7d'
  const [tool, ...rest] = caption.split(' ')
  ctx.fillText(tool!, 14, CAPTION_HEIGHT / 2)
  ctx.font = '15px "JBMono"'
  ctx.fillStyle = '#9da5b4'
  ctx.fillText(rest.join(' '), 14 + ctx.measureText(`${tool} `).width + 4, CAPTION_HEIGHT / 2)
  const png = canvas.toBuffer('image/png')
  for (let i = 0; i < Math.max(1, Math.round(ms / FRAME_MS)); i++) {
    writeFileSync(join(frames, `f${String(frameCount++).padStart(5, '0')}.png`), png)
  }
}

const quiet = {idleMs: 150, maxWaitMs: 3000}

/** Type `text` a few characters at a time, one frame per step, like watching keystrokes land. */
async function typeOut(caption: string, text: string): Promise<void> {
  for (let i = 0; i < text.length; i += 3) {
    await session.writeText(text.slice(i, i + 3), {idleMs: 40, maxWaitMs: 500})
    await shot(caption, FRAME_MS)
  }
}

await session.waitForReady()
await shot('terminal_create {"cols": 72, "rows": 17}', 1400)

await typeOut('terminal_type {"text": "vim fizz.py\\n"}', 'vim fizz.py')
await session.writeText('\n', {idleMs: 400, maxWaitMs: 3000})
await shot('terminal_type {"text": "vim fizz.py\\n"}', 1300)

await session.writeText('i', quiet)
await session.paste(PROGRAM, {idleMs: 300, maxWaitMs: 3000})
await shot('terminal_type {"text": "def fizzbuzz(n): …", "paste": true}', 2600)

await session.pressKey('Escape', 1, quiet)
await typeOut('terminal_batch [press Escape, type ":wq\\n"]', ':wq')
await shot('terminal_batch [press Escape, type ":wq\\n"]', 700)
await session.writeText('\n', {idleMs: 400, maxWaitMs: 3000})
await shot('terminal_batch [press Escape, type ":wq\\n"]', 900)

await typeOut('terminal_type {"text": "python3 fizz.py | tail -6\\n"}', 'python3 fizz.py | tail -6')
await session.writeText('\n', {idleMs: 500, maxWaitMs: 5000})
await shot('terminal_type {"text": "python3 fizz.py | tail -6\\n"}', 1500)

await typeOut('terminal_type {"text": "vim fizz.py\\n"}', 'vim fizz.py')
await session.writeText('\n', {idleMs: 400, maxWaitMs: 3000})
await session.writeText('3GV3j', quiet)
await shot('terminal_screenshot {}   what the agent sees', 3600)
// The standalone picture is exactly what terminal_screenshot returns: no caption strip.
const still = renderToPng(session.term, {fontSize: FONT_SIZE, theme: DARK_PLUS}).buffer

session.dispose()

// Two passes: build one palette from every frame, then encode with it.
// Without a shared palette a terminal's flat colors shimmer between frames.
const gif = join(OUT, 'demo.gif')
execFileSync(
  'ffmpeg',
  [
    '-y', '-loglevel', 'error',
    '-framerate', String(1000 / FRAME_MS),
    '-i', join(frames, 'f%05d.png'),
    '-vf', 'split[a][b];[a]palettegen=max_colors=48:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle',
    '-loop', '0',
    gif
  ],
  {stdio: 'inherit'}
)
writeFileSync(join(OUT, 'screenshot.png'), still)
rmSync(work, {recursive: true, force: true})
console.log(`wrote ${gif} and ${join(OUT, 'screenshot.png')} (${frameCount} frames)`)
process.exit(0)
