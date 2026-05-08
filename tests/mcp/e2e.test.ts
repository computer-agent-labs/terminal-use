import {readFile, stat, unlink} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {afterEach, beforeEach, describe, expect, it} from 'vitest'

import {call, startServer, type ServerHarness} from './helpers.js'

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

let harness: ServerHarness

beforeEach(async () => {
  harness = await startServer()
})

afterEach(async () => {
  await harness.shutdown()
})

describe('MCP end-to-end', () => {
  it('lists all six tools', async () => {
    const list = await harness.client.listTools()
    const names = list.tools.map(t => t.name).sort()
    expect(names).toEqual(
      [
        'terminal_press',
        'terminal_read',
        'terminal_reset',
        'terminal_resize',
        'terminal_screenshot',
        'terminal_type'
      ].sort()
    )
  })

  it('type → press Enter → read shows output', async () => {
    let r = await call(harness.client, 'terminal_type', {text: 'echo e2e-marker'})
    expect(r.isError).toBe(false)
    r = await call(harness.client, 'terminal_press', {key: 'Enter'})
    expect(r.isError).toBe(false)
    r = await call(harness.client, 'terminal_read', {})
    expect(r.isError).toBe(false)
    expect(r.text).toMatch(/e2e-marker/)
  })

  it('resize updates the terminal and shell sees it', async () => {
    let r = await call(harness.client, 'terminal_resize', {cols: 70, rows: 18})
    expect(r.isError).toBe(false)
    expect(r.text).toMatch(/70x18/)
    r = await call(harness.client, 'terminal_type', {text: 'stty size\n', idleMs: 300, maxWaitMs: 4000})
    expect(r.isError).toBe(false)
    expect(r.text).toMatch(/\b18 70\b/)
  })

  it('screenshot returns an inline PNG', async () => {
    await call(harness.client, 'terminal_type', {text: 'echo screenshot-marker\n', idleMs: 200, maxWaitMs: 3000})
    const r = await call(harness.client, 'terminal_screenshot', {})
    expect(r.isError).toBe(false)
    expect(r.imageMimeTypes).toEqual(['image/png'])
    expect(r.imageDataLengths[0]).toBeGreaterThan(64)
  })

  it('screenshot of older page works', async () => {
    await call(harness.client, 'terminal_type', {
      text: 'i=1; while [ $i -le 200 ]; do echo line$i; i=$((i+1)); done\n',
      idleMs: 600,
      maxWaitMs: 8000
    })
    const r = await call(harness.client, 'terminal_screenshot', {page: 5})
    expect(r.isError).toBe(false)
    expect(r.imageMimeTypes).toEqual(['image/png'])
  })

  it('maxWaitMs > 10000 triggers immediate deferred return', async () => {
    const r = await call(harness.client, 'terminal_type', {
      text: 'echo def\n',
      maxWaitMs: 30000
    })
    expect(r.isError).toBe(false)
    expect(r.text).toMatch(/Did not wait/)
  })

  it('soft reset preserves shell, hard reset replaces it', async () => {
    await call(harness.client, 'terminal_type', {text: 'echo $$\n', idleMs: 250, maxWaitMs: 3000})
    const before = await call(harness.client, 'terminal_read', {})
    const pidMatch = before.text.match(/Soft reset.*pid (\d+)|pid (\d+)/)

    await call(harness.client, 'terminal_reset', {})
    const after = await call(harness.client, 'terminal_reset', {hardReset: true})
    expect(after.text).toMatch(/Hard reset/)
    if (pidMatch) {
      const pid = pidMatch[1] ?? pidMatch[2]
      expect(after.text).not.toContain(`pid ${pid}`)
    }
  })

  it('screenshot with filePath writes a PNG to disk and inlines nothing', async () => {
    const path = join(tmpdir(), `terminal-use-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`)
    try {
      const r = await call(harness.client, 'terminal_screenshot', {filePath: path})
      expect(r.isError).toBe(false)
      expect(r.text).toContain(`Saved to ${path}`)
      expect(r.imageMimeTypes).toEqual([])
      const info = await stat(path)
      expect(info.size).toBeGreaterThan(64)
      const head = await readFile(path)
      expect(head.subarray(0, 8).equals(PNG_SIG)).toBe(true)
    } finally {
      await unlink(path).catch(() => undefined)
    }
  })

  it('paginated read returns earlier window', async () => {
    await call(harness.client, 'terminal_type', {
      text: 'i=1; while [ $i -le 150 ]; do echo line$i; i=$((i+1)); done\n',
      idleMs: 500,
      maxWaitMs: 6000
    })
    const page0 = await call(harness.client, 'terminal_read', {rows: 30, page: 0})
    const page2 = await call(harness.client, 'terminal_read', {rows: 30, page: 2})
    expect(page0.text).toMatch(/line150|line149|line148/)
    expect(page2.text).not.toMatch(/line150/)
    expect(page2.text).toMatch(/line\d+/)
  })
})
