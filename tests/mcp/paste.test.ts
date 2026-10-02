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

describe('terminal_type with paste', () => {
  it('wraps the text in paste markers once the program enables bracketed paste', async () => {
    const id = await createSession(harness.client)
    // `cat -v` shows the raw bytes it is sent.
    await call(harness.client, 'terminal_type', {sessionId: id, text: "printf '\\033[?2004h'; cat -v\n", ...settle})
    const r = await call(harness.client, 'terminal_type', {sessionId: id, text: 'one\ntwo', paste: true, ...settle})
    expect(r.text).toMatch(/as a bracketed paste/)
    expect(r.text).toContain('^[[200~one')
    expect(r.text).toContain('two^[[201~')
  })

  it('cannot be closed early by an end marker inside the text', async () => {
    const id = await createSession(harness.client)
    await call(harness.client, 'terminal_type', {sessionId: id, text: "printf '\\033[?2004h'; cat -v\n", ...settle})
    const r = await call(harness.client, 'terminal_type', {
      sessionId: id,
      text: 'safe\x1b[201~injected',
      paste: true,
      ...settle
    })
    expect(r.text).toContain('^[[200~safeinjected^[[201~')
  })

  it('falls back to plain input, and says so, when the program has not asked for it', async () => {
    const id = await createSession(harness.client)
    await call(harness.client, 'terminal_type', {sessionId: id, text: "printf '\\033[?2004l'; cat -v\n", ...settle})
    const r = await call(harness.client, 'terminal_type', {sessionId: id, text: 'plain', paste: true, ...settle})
    expect(r.text).toMatch(/as plain input/)
    expect(r.text).not.toContain('^[[200~')
  })
})
