import {mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {afterEach, beforeEach, describe, expect, it} from 'vitest'

import {call, startServer, type ServerHarness} from './helpers.js'

let harness: ServerHarness
let home: string

beforeEach(async () => {
  // A throwaway HOME whose profile sets a marker: only a login shell reads it.
  home = mkdtempSync(join(tmpdir(), 'terminal-use-home-'))
  writeFileSync(join(home, '.profile'), 'export FROM_PROFILE=yes\n')
  harness = await startServer()
})

afterEach(async () => {
  await harness.shutdown()
  rmSync(home, {recursive: true, force: true})
})

const settle = {idleMs: 300, maxWaitMs: 4000}

async function profileMarker(args: Record<string, unknown>): Promise<string> {
  const created = await call(harness.client, 'terminal_create', {env: {HOME: home}, ...args})
  const id = Number(created.text.match(/Created session (\d+)/)![1])
  await call(harness.client, 'terminal_type', {sessionId: id, text: 'echo marker=[$FROM_PROFILE]\n', ...settle})
  // A login shell can still be working through the system profile when the
  // prompt first shows; wait for the command to finish rather than for quiet.
  const r = await call(harness.client, 'terminal_wait', {sessionId: id, timeoutMs: 15000})
  return r.text.match(/^marker=\[(.*)\]$/m)![1]!
}

describe('login shells', () => {
  it('are off by default: the profile is not read', async () => {
    expect(await profileMarker({})).toBe('')
  })

  it('read the profile with login: true', async () => {
    expect(await profileMarker({login: true})).toBe('yes')
  })

  it('apply to command sessions too', async () => {
    const created = await call(harness.client, 'terminal_create', {
      env: {HOME: home},
      login: true,
      command: 'echo marker=[$FROM_PROFILE]'
    })
    const id = Number(created.text.match(/Created session (\d+)/)![1])
    const r = await call(harness.client, 'terminal_wait', {sessionId: id, timeoutMs: 10000})
    expect(r.text).toMatch(/^marker=\[yes\]$/m)
  })

  it('survive a respawn', async () => {
    const created = await call(harness.client, 'terminal_create', {env: {HOME: home}, login: true})
    const id = Number(created.text.match(/Created session (\d+)/)![1])
    await call(harness.client, 'terminal_type', {sessionId: id, text: 'exit\n', ...settle})
    await new Promise(r => setTimeout(r, 200))
    await call(harness.client, 'terminal_read', {sessionId: id})
    const r = await call(harness.client, 'terminal_type', {sessionId: id, text: 'echo marker=[$FROM_PROFILE]\n', ...settle})
    expect(r.text).toMatch(/^marker=\[yes\]$/m)
  })
})
