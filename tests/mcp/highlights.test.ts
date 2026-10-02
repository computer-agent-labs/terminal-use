import {afterEach, beforeEach, describe, expect, it} from 'vitest'

import {call, createSession, startServer, type ServerHarness} from './helpers.js'

let harness: ServerHarness

beforeEach(async () => {
  harness = await startServer()
})

afterEach(async () => {
  await harness.shutdown()
})

const settle = {idleMs: 250, maxWaitMs: 3000}

describe('highlights', () => {
  const menu =
    "clear; printf '  Apple\\n\\033[7m  Banana  \\033[0m\\n  Cherry\\n\\033[44m Save \\033[0m  Cancel\\n'\n"

  it('lists reverse-video and background-colored text with click coordinates', async () => {
    const id = await createSession(harness.client, {cols: 40, rows: 12})
    const r = await call(harness.client, 'terminal_type', {sessionId: id, text: menu, ...settle})
    expect(r.text).toMatch(/Highlighted on screen/)
    expect(r.text).toContain('row 2, cols 1-10: "Banana"')
    expect(r.text).toContain('row 4, cols 1-6: "Save"')
    expect(r.text).not.toMatch(/row \d+, cols [\d-]+: "(Apple|Cherry|Cancel)"/)
  })

  it('says nothing when nothing is highlighted, and can be switched off', async () => {
    const id = await createSession(harness.client, {cols: 40, rows: 12})
    const plain = await call(harness.client, 'terminal_type', {sessionId: id, text: 'clear; echo plain\n', ...settle})
    expect(plain.text).not.toMatch(/Highlighted/)
    await call(harness.client, 'terminal_type', {sessionId: id, text: menu, ...settle})
    const off = await call(harness.client, 'terminal_read', {sessionId: id, highlights: false})
    expect(off.text).not.toMatch(/Highlighted/)
  })

  it('points to a screenshot instead when most of the screen is colored', async () => {
    const id = await createSession(harness.client, {cols: 20, rows: 6})
    const r = await call(harness.client, 'terminal_type', {
      sessionId: id,
      text:
        "clear; for c in 41 42 43 44 45; do printf '\\033[%sm%-20s\\033[0m' $c panel; done\n",
      ...settle
    })
    expect(r.text).toMatch(/highlights are not listed/)
  })
})
