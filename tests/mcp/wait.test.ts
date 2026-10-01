import {afterEach, beforeEach, describe, expect, it} from 'vitest'

import {call, createSession, startServer, type ServerHarness} from './helpers.js'

let harness: ServerHarness

beforeEach(async () => {
  harness = await startServer()
})

afterEach(async () => {
  await harness.shutdown()
})

const quick = {idleMs: 100, maxWaitMs: 400}

describe('terminal_wait', () => {
  it('returns straight away when the shell is already at its prompt', async () => {
    const id = await createSession(harness.client)
    await call(harness.client, 'terminal_type', {sessionId: id, text: 'echo ready\n', idleMs: 250, maxWaitMs: 3000})
    const started = Date.now()
    const r = await call(harness.client, 'terminal_wait', {sessionId: id})
    expect(r.isError).toBe(false)
    expect(r.text).toMatch(/Command finished/)
    expect(Date.now() - started).toBeLessThan(1500)
  })

  it('waits out a command that is silent for longer than any settle window', async () => {
    const id = await createSession(harness.client)
    // terminal_type gives up after 400ms; the command prints nothing for 2s.
    const typed = await call(harness.client, 'terminal_type', {
      sessionId: id,
      text: 'sleep 2; echo fin""ished\n',
      ...quick
    })
    expect(typed.text).not.toMatch(/^finished$/m)
    const started = Date.now()
    const r = await call(harness.client, 'terminal_wait', {sessionId: id, timeoutMs: 10000})
    expect(r.isError).toBe(false)
    expect(r.text).toMatch(/Command finished/)
    expect(r.text).toMatch(/^finished$/m)
    expect(Date.now() - started).toBeGreaterThan(1000)
  })

  it('reports a timeout, without an error, while the command is still running', async () => {
    const id = await createSession(harness.client)
    await call(harness.client, 'terminal_type', {sessionId: id, text: 'sleep 30\n', ...quick})
    const r = await call(harness.client, 'terminal_wait', {sessionId: id, timeoutMs: 600})
    expect(r.isError).toBe(false)
    expect(r.text).toMatch(/Timed out after \d+ms: the command is still running/)
  })

  it('pattern mode returns as soon as the regex shows up, with the command still running', async () => {
    const id = await createSession(harness.client)
    await call(harness.client, 'terminal_type', {
      sessionId: id,
      text: 'sleep 1; echo Listening on port 30""00; sleep 30\n',
      ...quick
    })
    const started = Date.now()
    const r = await call(harness.client, 'terminal_wait', {
      sessionId: id,
      pattern: 'listening on port \\d{4}$',
      timeoutMs: 2000
    })
    expect(r.text).toMatch(/Timed out/)
    const ci = await call(harness.client, 'terminal_wait', {
      sessionId: id,
      pattern: '(?im)listening on port \\d{4}$',
      timeoutMs: 10000
    })
    expect(ci.text).toMatch(/matched after/)
    expect(Date.now() - started).toBeLessThan(8000)
  })

  it('until="quiet" waits for output to stop, even with a command still in the foreground', async () => {
    const id = await createSession(harness.client)
    await call(harness.client, 'terminal_type', {
      sessionId: id,
      text: 'for i in 1 2 3 4 5; do echo tick$i; sleep 0.3; done; sleep 30\n',
      ...quick
    })
    const started = Date.now()
    const r = await call(harness.client, 'terminal_wait', {sessionId: id, until: 'quiet', quietMs: 800, timeoutMs: 10000})
    expect(r.text).toMatch(/Output has been quiet for 800ms/)
    expect(r.text).toMatch(/^tick5$/m)
    expect(Date.now() - started).toBeGreaterThan(1200)
  })

  it('rejects an invalid pattern', async () => {
    const id = await createSession(harness.client)
    const r = await call(harness.client, 'terminal_wait', {sessionId: id, pattern: '(unclosed'})
    expect(r.isError).toBe(true)
    expect(r.text).toMatch(/Invalid pattern/)
  })

  it('returns when the shell exits while waiting, showing what it last printed', async () => {
    const id = await createSession(harness.client)
    await call(harness.client, 'terminal_type', {
      sessionId: id,
      text: 'sleep 1; echo last-w""ords; exit 3\n',
      ...quick
    })
    const r = await call(harness.client, 'terminal_wait', {sessionId: id, timeoutMs: 10000})
    expect(r.text).toMatch(/shell exited during this call \(exit code 3\)/)
    expect(r.text).toMatch(/^last-words$/m)
  })

  it('a slow call on one session does not block calls on another', async () => {
    const slow = await createSession(harness.client)
    const fast = await createSession(harness.client)
    const started = Date.now()
    const slowCall = call(harness.client, 'terminal_wait', {sessionId: slow, pattern: 'never-appears', timeoutMs: 2500})
    const r = await call(harness.client, 'terminal_read', {sessionId: fast})
    expect(r.isError).toBe(false)
    expect(Date.now() - started).toBeLessThan(1500)
    expect((await slowCall).text).toMatch(/Timed out/)
  })
})
