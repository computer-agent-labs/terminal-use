import {afterEach, beforeEach, describe, expect, it} from 'vitest'

import {call, startServer, type ServerHarness} from './helpers.js'

let harness: ServerHarness

beforeEach(async () => {
  harness = await startServer()
})

afterEach(async () => {
  await harness.shutdown()
})

describe('TUI / alt-buffer round-trip', () => {
  it('printf of \\x1b[?1049h flips to alt buffer in read; \\x1b[?1049l returns', async () => {
    let r = await call(harness.client, 'terminal_type', {
      text: "printf '\\033[?1049h\\033[Hin alt buffer\\n'\n",
      idleMs: 250,
      maxWaitMs: 3000
    })
    expect(r.isError).toBe(false)
    r = await call(harness.client, 'terminal_read', {})
    expect(r.text).toMatch(/alt buffer active/)

    await call(harness.client, 'terminal_type', {
      text: "printf '\\033[?1049l'\n",
      idleMs: 250,
      maxWaitMs: 3000
    })
    r = await call(harness.client, 'terminal_read', {})
    expect(r.text).not.toMatch(/alt buffer active/)
  })
})
