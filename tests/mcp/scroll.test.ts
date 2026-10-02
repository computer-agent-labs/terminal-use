import {afterEach, beforeEach, describe, expect, it} from 'vitest'

import {call, createSession, startServer, type ServerHarness} from './helpers.js'

let harness: ServerHarness

beforeEach(async () => {
  harness = await startServer()
})

afterEach(async () => {
  await harness.shutdown()
})

const settle = {idleMs: 300, maxWaitMs: 3000}

describe('terminal_scroll', () => {
  it('sends wheel events at the pointer cell to a program that tracks the mouse', async () => {
    const id = await createSession(harness.client, {cols: 80, rows: 24})
    await call(harness.client, 'terminal_type', {
      sessionId: id,
      text: "printf '\\033[?1000h\\033[?1006h'; cat -v\n",
      ...settle
    })
    const r = await call(harness.client, 'terminal_scroll', {
      sessionId: id,
      direction: 'down',
      amount: 2,
      col: 7,
      row: 4,
      ...settle
    })
    expect(r.isError).toBe(false)
    expect(r.text).toMatch(/Scrolled down 2 notches at \(col 7, row 4\)/)
    expect(r.text).toContain('^[[<65;7;4M^[[<65;7;4M')
  })

  it('becomes arrow keys in a full-screen program that does not track the mouse', async () => {
    const id = await createSession(harness.client, {cols: 80, rows: 24})
    await call(harness.client, 'terminal_type', {
      sessionId: id,
      text: "printf '\\033[?1049h'; cat -v\n",
      ...settle
    })
    const r = await call(harness.client, 'terminal_scroll', {sessionId: id, direction: 'up', ...settle})
    expect(r.isError).toBe(false)
    expect(r.text).toMatch(/Sent 3 ArrowUp keys/)
    expect(r.text).toContain('^[[A^[[A^[[A')
  })

  it('refuses at a plain shell prompt and points to terminal_read', async () => {
    const id = await createSession(harness.client)
    const r = await call(harness.client, 'terminal_scroll', {sessionId: id, direction: 'up'})
    expect(r.isError).toBe(true)
    expect(r.text).toMatch(/Nothing to scroll/)
    expect(r.text).toMatch(/terminal_read/)
  })
})
