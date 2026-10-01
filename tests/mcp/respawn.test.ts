import {realpathSync} from 'node:fs'
import {tmpdir} from 'node:os'

import {afterEach, beforeEach, describe, expect, it} from 'vitest'

import {call, createSession, startServer, type ServerHarness} from './helpers.js'

let harness: ServerHarness

beforeEach(async () => {
  harness = await startServer()
})

afterEach(async () => {
  await harness.shutdown()
})

describe('auto-respawn', () => {
  it('brings the session back with the size and cwd it was created with', async () => {
    const cwd = realpathSync(tmpdir())
    const id = await createSession(harness.client, {cols: 91, rows: 17, cwd})
    await call(harness.client, 'terminal_type', {sessionId: id, text: 'exit\n', idleMs: 250, maxWaitMs: 3000})
    await new Promise(r => setTimeout(r, 200))

    const notice = await call(harness.client, 'terminal_read', {sessionId: id})
    expect(notice.isError).toBe(true)
    expect(notice.text).toMatch(/shell exited/)

    const list = await call(harness.client, 'terminal_list', {})
    expect(list.text).toContain(`[${id}] 91x17`)
    expect(list.text).toContain(`cwd=${cwd} `)

    const pwd = await call(harness.client, 'terminal_type', {
      sessionId: id,
      text: 'pwd -P\n',
      idleMs: 250,
      maxWaitMs: 3000
    })
    expect(pwd.text).toMatch(/^Terminal: 91x17/m)
    expect(pwd.text).toContain(cwd)
  })

  it('keeps a resize across the respawn', async () => {
    const id = await createSession(harness.client)
    await call(harness.client, 'terminal_resize', {sessionId: id, cols: 77, rows: 21})
    await call(harness.client, 'terminal_type', {sessionId: id, text: 'exit\n', idleMs: 250, maxWaitMs: 3000})
    await new Promise(r => setTimeout(r, 200))
    await call(harness.client, 'terminal_read', {sessionId: id})
    const r = await call(harness.client, 'terminal_read', {sessionId: id})
    expect(r.text).toMatch(/^Terminal: 77x21/)
  })

  it('the respawn notice carries the last screen the dead shell printed', async () => {
    const id = await createSession(harness.client)
    await call(harness.client, 'terminal_type', {
      sessionId: id,
      text: 'echo fatal: out of cheese; exit 7\n',
      idleMs: 250,
      maxWaitMs: 3000
    })
    await new Promise(r => setTimeout(r, 200))
    const notice = await call(harness.client, 'terminal_read', {sessionId: id})
    expect(notice.isError).toBe(true)
    expect(notice.text).toMatch(/exit code 7/)
    expect(notice.text).toMatch(/Last screen before the shell exited:/)
    expect(notice.text).toMatch(/^fatal: out of cheese$/m)
  })
})

describe('idle-kill', () => {
  it('leaves a session alone while it is still producing output', async () => {
    await harness.shutdown()
    harness = await startServer({idleKillMs: 1200, sweepIntervalMs: 100})
    const busy = await createSession(harness.client, {label: 'busy'})
    const idle = await createSession(harness.client, {label: 'idle'})
    await call(harness.client, 'terminal_type', {
      sessionId: busy,
      text: 'while true; do echo tick; sleep 0.2; done\n',
      idleMs: 50,
      maxWaitMs: 200
    })
    await new Promise(r => setTimeout(r, 2000))
    const list = await call(harness.client, 'terminal_list', {})
    expect(list.text).toMatch(new RegExp(`\\[${busy} \\("busy"\\)\\] \\d+x\\d+ pid=`))
    expect(list.text).toMatch(new RegExp(`\\[${idle} \\("idle"\\)\\] tombstoned: idle-killed`))
  })
})

describe('shutdown', () => {
  it('closing the server removes its attach sockets', async () => {
    const {existsSync} = await import('node:fs')
    const r = await call(harness.client, 'terminal_create', {})
    const socket = r.text.match(/\S*terminal-use-\d+-\d+\.sock/)![0]
    expect(existsSync(socket)).toBe(true)
    await harness.shutdown()
    expect(existsSync(socket)).toBe(false)
    harness = await startServer()
  })
})
