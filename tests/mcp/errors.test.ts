import {afterEach, beforeEach, describe, expect, it} from 'vitest'

import {call, createSession, startServer, type ServerHarness} from './helpers.js'

let harness: ServerHarness

beforeEach(async () => {
  harness = await startServer()
})

afterEach(async () => {
  await harness.shutdown()
})

describe('MCP error paths', () => {
  it('rows > 1000 in read is rejected by schema validation', async () => {
    const id = await createSession(harness.client)
    const r = await call(harness.client, 'terminal_read', {sessionId: id, rows: 9999})
    expect(r.isError).toBe(true)
    expect(r.text).toMatch(/less than or equal to 1000|too_big/i)
  })

  it('cols=0 in resize is rejected by schema validation', async () => {
    const id = await createSession(harness.client)
    const r = await call(harness.client, 'terminal_resize', {sessionId: id, cols: 0})
    expect(r.isError).toBe(true)
  })

  it('handler error for unknown key surfaces as isError + message', async () => {
    const id = await createSession(harness.client)
    const r = await call(harness.client, 'terminal_press', {sessionId: id, key: 'NotARealKey'})
    expect(r.isError).toBe(true)
    expect(r.text).toMatch(/Unknown key/i)
  })

  it('hard reset to a missing cwd does not crash the server', async () => {
    const id = await createSession(harness.client)
    await call(harness.client, 'terminal_reset', {
      sessionId: id,
      hardReset: true,
      cwd: '/this/path/should/not/exist/anywhere'
    })
    const r = await call(harness.client, 'terminal_read', {sessionId: id})
    expect(r.isError).toBe(false)
  })

  it('handler error does not crash the server (subsequent calls work)', async () => {
    const id = await createSession(harness.client)
    await call(harness.client, 'terminal_press', {sessionId: id, key: 'NotARealKey'})
    const r = await call(harness.client, 'terminal_read', {sessionId: id})
    expect(r.isError).toBe(false)
  })
})
