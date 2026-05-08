import {afterEach, beforeEach, describe, expect, it} from 'vitest'

import {call, startServer, type ServerHarness} from './helpers.js'

let harness: ServerHarness

beforeEach(async () => {
  harness = await startServer()
})

afterEach(async () => {
  await harness.shutdown()
})

function extractSessionId(text: string): number {
  const m = text.match(/Created session (\d+)/)
  if (!m) throw new Error(`Could not find sessionId in: ${text}`)
  return parseInt(m[1]!, 10)
}

describe('multi-session', () => {
  it('terminal_create returns a fresh sessionId and includes label when provided', async () => {
    const r = await call(harness.client, 'terminal_create', {label: 'first'})
    expect(r.isError).toBe(false)
    expect(r.text).toMatch(/Created session 1.*"first"/)
    expect(r.text).toMatch(/\[1 \(first\)\]/)
  })

  it('two terminal_create calls return distinct ids and both show in terminal_list', async () => {
    const a = await call(harness.client, 'terminal_create', {label: 'a'})
    const b = await call(harness.client, 'terminal_create', {label: 'b'})
    const idA = extractSessionId(a.text)
    const idB = extractSessionId(b.text)
    expect(idA).not.toBe(idB)

    const listed = await call(harness.client, 'terminal_list', {})
    expect(listed.text).toMatch(/2 session\(s\)/)
    expect(listed.text).toMatch(new RegExp(`\\[${idA} \\(a\\)\\]`))
    expect(listed.text).toMatch(new RegExp(`\\[${idB} \\(b\\)\\]`))
  })

  it('typing into specific sessionIds keeps state independent', async () => {
    const a = await call(harness.client, 'terminal_create', {label: 'a'})
    const b = await call(harness.client, 'terminal_create', {label: 'b'})
    const idA = extractSessionId(a.text)
    const idB = extractSessionId(b.text)

    await call(harness.client, 'terminal_type', {
      sessionId: idA,
      text: 'echo only-in-a\n',
      idleMs: 250,
      maxWaitMs: 3000
    })
    await call(harness.client, 'terminal_type', {
      sessionId: idB,
      text: 'echo only-in-b\n',
      idleMs: 250,
      maxWaitMs: 3000
    })

    const readA = await call(harness.client, 'terminal_read', {sessionId: idA})
    expect(readA.text).toMatch(/only-in-a/)
    expect(readA.text).not.toMatch(/only-in-b/)

    const readB = await call(harness.client, 'terminal_read', {sessionId: idB})
    expect(readB.text).toMatch(/only-in-b/)
    expect(readB.text).not.toMatch(/only-in-a/)
  })

  it('terminal_select changes the default for tools that omit sessionId', async () => {
    const a = await call(harness.client, 'terminal_create', {label: 'a'})
    const b = await call(harness.client, 'terminal_create', {label: 'b'})
    const idA = extractSessionId(a.text)
    const idB = extractSessionId(b.text)

    await call(harness.client, 'terminal_select', {sessionId: idB})
    await call(harness.client, 'terminal_type', {
      text: 'echo selected-default\n',
      idleMs: 250,
      maxWaitMs: 3000
    })

    const readA = await call(harness.client, 'terminal_read', {sessionId: idA})
    expect(readA.text).not.toMatch(/selected-default/)
    const readB = await call(harness.client, 'terminal_read', {sessionId: idB})
    expect(readB.text).toMatch(/selected-default/)
  })

  it('targeting an unknown sessionId surfaces a clean error', async () => {
    const r = await call(harness.client, 'terminal_type', {
      sessionId: 999,
      text: 'echo no\n'
    })
    expect(r.isError).toBe(true)
    expect(r.text).toMatch(/Unknown sessionId 999/)
  })

  it('terminal_destroy removes the session and rolls the default forward', async () => {
    const a = await call(harness.client, 'terminal_create', {label: 'a'})
    const b = await call(harness.client, 'terminal_create', {label: 'b'})
    const idA = extractSessionId(a.text)
    const idB = extractSessionId(b.text)
    await call(harness.client, 'terminal_select', {sessionId: idA})

    const destroyed = await call(harness.client, 'terminal_destroy', {sessionId: idA})
    expect(destroyed.isError).toBe(false)
    expect(destroyed.text).toMatch(`Destroyed session ${idA}`)

    // Default rolls forward to the remaining session (b).
    const r = await call(harness.client, 'terminal_type', {
      text: 'echo new-default\n',
      idleMs: 250,
      maxWaitMs: 3000
    })
    expect(r.isError).toBe(false)
    const readB = await call(harness.client, 'terminal_read', {sessionId: idB})
    expect(readB.text).toMatch(/new-default/)

    // The old session is gone.
    const ghost = await call(harness.client, 'terminal_read', {sessionId: idA})
    expect(ghost.isError).toBe(true)
    expect(ghost.text).toMatch(`Unknown sessionId ${idA}`)
  })

  it('destroying every session means the next call lazy-creates a fresh one', async () => {
    const a = await call(harness.client, 'terminal_create', {})
    const idA = extractSessionId(a.text)
    await call(harness.client, 'terminal_destroy', {sessionId: idA})

    const r = await call(harness.client, 'terminal_type', {
      text: 'echo back-from-empty\n',
      idleMs: 250,
      maxWaitMs: 3000
    })
    expect(r.isError).toBe(false)

    const listed = await call(harness.client, 'terminal_list', {})
    expect(listed.text).toMatch(/1 session\(s\)/)
  })

  it('auto-respawn keeps the same sessionId and notes which session was respawned', async () => {
    const a = await call(harness.client, 'terminal_create', {label: 'will-die'})
    const idA = extractSessionId(a.text)

    await call(harness.client, 'terminal_type', {
      sessionId: idA,
      text: 'exit\n',
      idleMs: 250,
      maxWaitMs: 3000
    })
    await new Promise(r => setTimeout(r, 800))

    const r = await call(harness.client, 'terminal_type', {
      sessionId: idA,
      text: 'echo after\n',
      idleMs: 250,
      maxWaitMs: 3000
    })
    expect(r.isError).toBe(true)
    expect(r.text).toMatch(new RegExp(`Session ${idA}'s shell exited`))

    // sessionId is preserved — the new shell answers to the same id.
    const listed = await call(harness.client, 'terminal_list', {})
    expect(listed.text).toMatch(new RegExp(`\\[${idA} \\(will-die\\)\\]`))
  })
})
