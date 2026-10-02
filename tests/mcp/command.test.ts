import {afterEach, beforeEach, describe, expect, it} from 'vitest'

import {call, startServer, type ServerHarness} from './helpers.js'

let harness: ServerHarness

beforeEach(async () => {
  harness = await startServer()
})

afterEach(async () => {
  await harness.shutdown()
})

const settle = {idleMs: 250, maxWaitMs: 3000}

async function create(args: Record<string, unknown>): Promise<number> {
  const r = await call(harness.client, 'terminal_create', args)
  expect(r.isError).toBe(false)
  return Number(r.text.match(/Created session (\d+)/)![1])
}

describe('sessions created with a command', () => {
  it('run the command, report its exit status, and keep the final screen readable', async () => {
    const id = await create({command: 'echo building; sleep 0.5; echo "failed: 2 errors"; exit 3'})
    const waited = await call(harness.client, 'terminal_wait', {sessionId: id, timeoutMs: 10000})
    expect(waited.isError).toBe(false)
    expect(waited.text).toMatch(/The command exited \(exit code 3\)/)
    expect(waited.text).toMatch(/^failed: 2 errors$/m)

    const read = await call(harness.client, 'terminal_read', {sessionId: id})
    expect(read.isError).toBe(false)
    expect(read.text).toMatch(/The command exited \(exit code 3\) at .*this is its final screen/)
    expect(read.text).toMatch(/^building$/m)

    const shot = await call(harness.client, 'terminal_screenshot', {sessionId: id})
    expect(shot.isError).toBe(false)
    expect(shot.imageMimeTypes).toEqual(['image/png'])

    const list = await call(harness.client, 'terminal_list', {})
    expect(list.text).toMatch(new RegExp(`\\[${id}\\] .*EXITED \\(exit code 3\\) command=`))
  })

  it('talk to the program directly, with no shell in between', async () => {
    const id = await create({command: 'cat -n'})
    const typed = await call(harness.client, 'terminal_type', {sessionId: id, text: 'hello\n', ...settle})
    expect(typed.text).toMatch(/^\s+1\s+hello$/m)
    const eof = await call(harness.client, 'terminal_press', {sessionId: id, key: 'Ctrl+D', ...settle})
    expect(eof.text).toMatch(/The command exited \(exit code 0\)/)
  })

  it('refuse input once the command has exited, without restarting it', async () => {
    const id = await create({command: 'echo once; exit 5'})
    await call(harness.client, 'terminal_wait', {sessionId: id, timeoutMs: 10000})
    const typed = await call(harness.client, 'terminal_type', {sessionId: id, text: 'anything\n', ...settle})
    expect(typed.isError).toBe(true)
    expect(typed.text).toMatch(/which exited \(exit code 5\)/)
    expect(typed.text).toMatch(/hardReset: true runs the command again/)
    const read = await call(harness.client, 'terminal_read', {sessionId: id})
    expect(read.text.match(/^once$/gm)).toHaveLength(1)
  })

  it('run again on a hard reset', async () => {
    const id = await create({command: 'echo run-$$; exit 1'})
    await call(harness.client, 'terminal_wait', {sessionId: id, timeoutMs: 10000})
    const first = (await call(harness.client, 'terminal_read', {sessionId: id})).text.match(/run-\d+/)![0]
    const reset = await call(harness.client, 'terminal_reset', {sessionId: id, hardReset: true})
    expect(reset.text).toMatch(/running `echo run-\$\$; exit 1` again/)
    await call(harness.client, 'terminal_wait', {sessionId: id, timeoutMs: 10000})
    const second = (await call(harness.client, 'terminal_read', {sessionId: id})).text.match(/run-\d+/)![0]
    expect(second).not.toBe(first)
  })

  it('report a timeout while the command is still running', async () => {
    const id = await create({command: 'sleep 30'})
    const r = await call(harness.client, 'terminal_wait', {sessionId: id, timeoutMs: 500})
    expect(r.text).toMatch(/Timed out after \d+ms: the command is still running/)
  })

  it('are not restarted after being idle-closed', async () => {
    await harness.shutdown()
    harness = await startServer({idleKillMs: 300, sweepIntervalMs: 100})
    const id = await create({command: 'echo done'})
    await new Promise(r => setTimeout(r, 900))
    const r = await call(harness.client, 'terminal_read', {sessionId: id})
    expect(r.isError).toBe(true)
    expect(r.text).toMatch(/closed after sitting idle/)
    expect(r.text).toMatch(/was not restarted/)
    const again = await call(harness.client, 'terminal_read', {sessionId: id})
    expect(again.text).toMatch(/Unknown sessionId/)
  })
})

describe('env', () => {
  it('sets variables for a shell session', async () => {
    const id = await create({env: {TERMINAL_USE_TEST_VAR: 'from-env'}})
    const r = await call(harness.client, 'terminal_type', {sessionId: id, text: 'echo v=$TERMINAL_USE_TEST_VAR\n', ...settle})
    expect(r.text).toMatch(/^v=from-env$/m)
  })

  it('sets variables for a command session', async () => {
    const id = await create({command: 'echo v=$TERMINAL_USE_TEST_VAR', env: {TERMINAL_USE_TEST_VAR: 'cmd-env'}})
    const r = await call(harness.client, 'terminal_wait', {sessionId: id, timeoutMs: 10000})
    expect(r.text).toMatch(/^v=cmd-env$/m)
  })
})
