import {afterEach, beforeEach, describe, expect, it} from 'vitest'

import {call, createSession, startServer, type ServerHarness} from './helpers.js'

let harness: ServerHarness

beforeEach(async () => {
  harness = await startServer()
})

afterEach(async () => {
  await harness.shutdown()
})

describe('terminal_batch', () => {
  it('runs mixed actions in order and returns the screen once', async () => {
    const id = await createSession(harness.client)
    const r = await call(harness.client, 'terminal_batch', {
      sessionId: id,
      actions: [
        {type: 'type', text: 'echo abXcd'},
        {type: 'press', key: 'ArrowLeft', count: 2},
        {type: 'press', key: 'Backspace'},
        {type: 'press', key: 'Enter'},
        {type: 'wait', pattern: '^abcd$'},
        {type: 'type', text: 'echo second\n'}
      ]
    })
    expect(r.isError).toBe(false)
    expect(r.text).toMatch(/Ran all 6 actions/)
    expect(r.text).toMatch(/^abcd$/m)
    expect(r.text).toMatch(/^second$/m)
    expect(r.text.match(/Showing rows/g)).toHaveLength(1)
  })

  it('validates the whole batch before sending anything', async () => {
    const id = await createSession(harness.client)
    const r = await call(harness.client, 'terminal_batch', {
      sessionId: id,
      actions: [
        {type: 'type', text: 'echo should-not-run\n'},
        {type: 'press', key: 'NoSuchKey'}
      ]
    })
    expect(r.isError).toBe(true)
    expect(r.text).toMatch(/Action 2 \(press\): .*Nothing was sent/)
    const read = await call(harness.client, 'terminal_read', {sessionId: id})
    expect(read.text).not.toMatch(/should-not-run/)
  })

  it('stops at the first failing action and says how far it got', async () => {
    const id = await createSession(harness.client)
    const r = await call(harness.client, 'terminal_batch', {
      sessionId: id,
      actions: [
        {type: 'type', text: 'echo first\n'},
        {type: 'wait', pattern: 'never-shows-up', timeoutMs: 400},
        {type: 'type', text: 'echo third\n'}
      ]
    })
    expect(r.isError).toBe(true)
    expect(r.text).toMatch(/Stopped at action 2 of 3 \(wait for \/never-shows-up\/\)/)
    expect(r.text).toMatch(/1 action before it was sent/)
    expect(r.text).toMatch(/^first$/m)
    expect(r.text).not.toMatch(/^third$/m)
  })

  it('stops when the process exits partway through', async () => {
    const r0 = await call(harness.client, 'terminal_create', {command: 'cat'})
    const id = Number(r0.text.match(/Created session (\d+)/)![1])
    const r = await call(harness.client, 'terminal_batch', {
      sessionId: id,
      actions: [
        {type: 'type', text: 'line\n'},
        {type: 'press', key: 'Ctrl+D'},
        {type: 'type', text: 'too late\n'}
      ]
    })
    expect(r.text).toMatch(/Stopped after action 2 of 3 \(press Ctrl\+D\): the process exited/)
    expect(r.text).toMatch(/The command exited \(exit code 0\)/)
    expect(r.text).not.toMatch(/too late/)
  })

  it('a fixed wait pauses between actions', async () => {
    const id = await createSession(harness.client)
    const started = Date.now()
    const r = await call(harness.client, 'terminal_batch', {
      sessionId: id,
      actions: [
        {type: 'wait', ms: 600},
        {type: 'type', text: 'echo after-pause\n'}
      ]
    })
    expect(Date.now() - started).toBeGreaterThanOrEqual(600)
    expect(r.text).toMatch(/^after-pause$/m)
  })
})
