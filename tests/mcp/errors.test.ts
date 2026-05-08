import {afterEach, beforeEach, describe, expect, it} from 'vitest'

import {call, startServer, type ServerHarness} from './helpers.js'

let harness: ServerHarness

beforeEach(async () => {
  harness = await startServer()
})

afterEach(async () => {
  await harness.shutdown()
})

describe('MCP error paths', () => {
  it('rows > 1000 in read is rejected by schema validation', async () => {
    const r = await call(harness.client, 'terminal_read', {rows: 9999})
    expect(r.isError).toBe(true)
    expect(r.text).toMatch(/less than or equal to 1000|too_big/i)
  })

  it('cols=0 in resize is rejected by schema validation', async () => {
    const r = await call(harness.client, 'terminal_resize', {cols: 0})
    expect(r.isError).toBe(true)
  })

  it('handler error for unknown key surfaces as isError + message', async () => {
    const r = await call(harness.client, 'terminal_press', {key: 'NotARealKey'})
    expect(r.isError).toBe(true)
    expect(r.text).toMatch(/Unknown key/i)
  })

  it('hard reset to a missing cwd does not crash the server', async () => {
    // node-pty may or may not propagate the chdir failure depending on platform;
    // we only require that the server stays responsive afterwards.
    await call(harness.client, 'terminal_reset', {
      hardReset: true,
      cwd: '/this/path/should/not/exist/anywhere'
    })
    const r = await call(harness.client, 'terminal_read', {})
    expect(r.isError).toBe(false)
  })

  it('handler error does not crash the server (subsequent calls work)', async () => {
    await call(harness.client, 'terminal_press', {key: 'NotARealKey'})
    const r = await call(harness.client, 'terminal_read', {})
    expect(r.isError).toBe(false)
  })
})
