import {readFile, stat, unlink} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {afterEach, beforeEach, describe, expect, it} from 'vitest'

import {call, createSession, startServer, type ServerHarness} from './helpers.js'

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

let harness: ServerHarness

beforeEach(async () => {
  harness = await startServer()
})

afterEach(async () => {
  await harness.shutdown()
})

describe('terminal_click', () => {
  it('preview mode (default) returns a PNG and does not deliver the click', async () => {
    const id = await createSession(harness.client)
    const r = await call(harness.client, 'terminal_click', {sessionId: id, col: 10, row: 5})
    expect(r.isError).toBe(false)
    expect(r.text).toMatch(/PREVIEW: click at \(col 10, row 5\)/)
    expect(r.text).toMatch(/No click was sent/)
    expect(r.imageMimeTypes).toEqual(['image/png'])
    expect(r.imageDataLengths[0]).toBeGreaterThan(64)
  })

  it('execute mode refuses to send a click when mouse tracking is off', async () => {
    const id = await createSession(harness.client)
    const r = await call(harness.client, 'terminal_click', {
      sessionId: id,
      col: 10,
      row: 5,
      preview: false
    })
    expect(r.isError).toBe(true)
    expect(r.text).toMatch(/has not enabled mouse tracking/)
  })

  it('execute mode delivers the SGR sequence when mouse tracking is on', async () => {
    const id = await createSession(harness.client)
    // Enable mouse tracking by having a tiny shell loop:
    //  1. printf the DECSET enable sequences so xterm-headless flips mode
    //  2. cat -u into a file so we can observe what the program "sees"
    // The cat keeps the foreground process alive with mouse tracking
    // enabled, and writes any mouse-event bytes it receives to /tmp/click_X.
    const path = `/tmp/terminal-use-click-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    await call(harness.client, 'terminal_type', {
      sessionId: id,
      text: `printf '\\033[?1000h\\033[?1006h' && cat > ${path}\n`,
      idleMs: 300,
      maxWaitMs: 3000
    })
    // Give the shell a moment to actually start cat with the enabled mode.
    await new Promise(r => setTimeout(r, 200))

    const r = await call(harness.client, 'terminal_click', {
      sessionId: id,
      col: 7,
      row: 3,
      preview: false,
      idleMs: 200,
      maxWaitMs: 2000
    })
    expect(r.isError).toBe(false)
    expect(r.text).toMatch(/Clicked at \(col 7, row 3\)/)

    // End the cat by sending Ctrl+D, then verify the file got the click sequence.
    await call(harness.client, 'terminal_press', {
      sessionId: id,
      key: 'Ctrl+D',
      idleMs: 200,
      maxWaitMs: 1000
    })
    const {readFile, unlink} = await import('node:fs/promises')
    let content = ''
    try {
      content = await readFile(path, 'utf8')
    } finally {
      await unlink(path).catch(() => undefined)
    }
    expect(content).toContain('\x1b[<0;7;3M')
    expect(content).toContain('\x1b[<0;7;3m')
  })

  it('preview mode with filePath writes the PNG to disk and inlines nothing', async () => {
    const id = await createSession(harness.client)
    const path = join(
      tmpdir(),
      `terminal-use-click-preview-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`
    )
    try {
      const r = await call(harness.client, 'terminal_click', {
        sessionId: id,
        col: 8,
        row: 4,
        filePath: path
      })
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

  it('refuses coordinates outside the viewport (handler-level)', async () => {
    const id = await createSession(harness.client)
    // Default viewport is 120x30; col=200 is within the schema cap (1000) but
    // outside the actual terminal, so the handler should reject.
    const r = await call(harness.client, 'terminal_click', {
      sessionId: id,
      col: 200,
      row: 1
    })
    expect(r.isError).toBe(true)
    expect(r.text).toMatch(/outside the .* viewport/)
  })
})
