import {afterEach, beforeEach, describe, expect, it} from 'vitest'

import {call, createSession, startServer, type ServerHarness} from './helpers.js'

let harness: ServerHarness

beforeEach(async () => {
  harness = await startServer({idleKillMs: 50, tombstoneRetentionMs: 60_000})
})

afterEach(async () => {
  await harness.shutdown()
})

async function listText(): Promise<string> {
  const r = await call(harness.client, 'terminal_list', {})
  return r.text
}

describe('idle-kill + tombstones', () => {
  it('a tombstoned sessionId still auto-respawns when called against, with the right reason', async () => {
    // Use a moderate idle threshold so we can do a normal-paced second call
    // after the respawn without getting re-killed in flight.
    await harness.shutdown()
    harness = await startServer({idleKillMs: 1500, sweepIntervalMs: 100})

    const id = await createSession(harness.client, {label: 'idler'})

    // Wait long enough for the idle-kill sweep to fire (>1500ms, with margin).
    await new Promise(r => setTimeout(r, 1800))

    // The session should now be tombstoned.
    const before = await listText()
    expect(before).toMatch(/tombstoned: idle-killed/)
    expect(before).toMatch(new RegExp(`\\[${id} \\("idler"\\)\\]`))

    // Calling against the tombstoned id should respawn with the right notice.
    const r = await call(harness.client, 'terminal_type', {
      sessionId: id,
      text: 'echo back-from-the-dead\n',
      idleMs: 200,
      maxWaitMs: 2000
    })
    expect(r.isError).toBe(true)
    expect(r.text).toMatch(/terminated due to inactivity/)
    expect(r.text).toMatch(new RegExp(`Session ${id} \\("idler"\\)`))

    // Subsequent call works normally — issue it immediately so the freshly-
    // respawned session's lastActivityAt is well within idleKillMs.
    const r2 = await call(harness.client, 'terminal_type', {
      sessionId: id,
      text: 'echo alive-again\n',
      idleMs: 250,
      maxWaitMs: 3000
    })
    expect(r2.isError).toBe(false)
    const read = await call(harness.client, 'terminal_read', {sessionId: id})
    expect(read.text).toMatch(/alive-again/)
  })

  it('expired tombstones become Unknown sessionId', async () => {
    await harness.shutdown()
    harness = await startServer({
      idleKillMs: 30,
      sweepIntervalMs: 25,
      tombstoneRetentionMs: 50
    })

    const id = await createSession(harness.client)
    // First, idle-kill it. Then wait for tombstone retention to elapse and
    // the GC sweep to drop it.
    await new Promise(r => setTimeout(r, 300))

    const r = await call(harness.client, 'terminal_type', {
      sessionId: id,
      text: 'echo nope\n'
    })
    expect(r.isError).toBe(true)
    expect(r.text).toMatch(`Unknown sessionId ${id}`)
  })
})

describe('LRU eviction', () => {
  it('exceeding maxSessions evicts the least-recently-used session and tombstones it as evicted', async () => {
    await harness.shutdown()
    harness = await startServer({maxSessions: 2})

    const idA = await createSession(harness.client, {label: 'A'})
    // Touch A so it becomes more recent than B.
    await call(harness.client, 'terminal_read', {sessionId: idA})
    const idB = await createSession(harness.client, {label: 'B'})
    // A is older than B by activity time. When we create C, A or B should be evicted.
    // Activity recency: idA was just touched, idB was just created. So the older is idA's
    // pre-touch... actually after we created B, A's lastActivityAt was just bumped by the
    // read. B's lastActivityAt is its createdAt. They're very close. To make the order
    // deterministic, touch B again.
    await new Promise(r => setTimeout(r, 5))
    await call(harness.client, 'terminal_read', {sessionId: idB})

    // Now A is older than B. Creating C should evict A.
    const idC = await createSession(harness.client, {label: 'C'})

    const list = await listText()
    expect(list).toMatch(new RegExp(`\\[${idB} \\("B"\\)\\]`))
    expect(list).toMatch(new RegExp(`\\[${idC} \\("C"\\)\\]`))
    expect(list).toMatch(new RegExp(`\\[${idA} \\("A"\\)\\] tombstoned: evicted`))

    // Calling against the evicted id respawns with the eviction notice.
    const r = await call(harness.client, 'terminal_type', {
      sessionId: idA,
      text: 'echo back\n',
      idleMs: 250,
      maxWaitMs: 2000
    })
    expect(r.isError).toBe(true)
    expect(r.text).toMatch(/evicted at .* because the session cap/)
  })
})
