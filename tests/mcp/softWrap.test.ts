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

describe('soft-wrapped lines', () => {
  const long = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet'

  it('are joined back into the line the program printed', async () => {
    const id = await createSession(harness.client, {cols: 30, rows: 12})
    await call(harness.client, 'terminal_type', {sessionId: id, text: `clear; printf '%s\\n' "${long}"\n`, ...settle})
    const r = await call(harness.client, 'terminal_read', {sessionId: id})
    expect(r.text).toMatch(new RegExp(`^${long}$`, 'm'))
    expect(r.text).toMatch(/soft-wrapped rows? joined/)
  })

  it('stay one line per screen row with joinWrapped: false', async () => {
    const id = await createSession(harness.client, {cols: 30, rows: 12})
    await call(harness.client, 'terminal_type', {sessionId: id, text: `clear; printf '%s\\n' "${long}"\n`, ...settle})
    const r = await call(harness.client, 'terminal_read', {sessionId: id, joinWrapped: false})
    expect(r.text).not.toMatch(new RegExp(`^${long}$`, 'm'))
    expect(r.text).toMatch(/^alpha bravo charlie delta echo$/m)
    expect(r.text).not.toMatch(/joined/)
  })

  it('keep the cursor on the right character of a wrapped command line', async () => {
    const id = await createSession(harness.client, {cols: 30, rows: 12})
    await call(harness.client, 'terminal_type', {sessionId: id, text: `echo ${long}`, ...settle})
    const r = await call(harness.client, 'terminal_press', {sessionId: id, key: 'ArrowLeft', count: 6, ...settle})
    expect(r.text).toContain('india ▌juliet')
    expect(r.text).toContain('in front of the "j" it is on')
  })
})
