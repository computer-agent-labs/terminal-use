import {afterEach, describe, expect, it} from 'vitest'

import {TerminalSession} from '../../src/session/TerminalSession.js'

let active: TerminalSession | null = null

afterEach(() => {
  if (active) {
    active.dispose()
    active = null
  }
})

function makeSession(): TerminalSession {
  active = new TerminalSession({shell: '/bin/sh', cwd: process.cwd(), cols: 80, rows: 24})
  return active
}

const SETTLE = {idleMs: 250, maxWaitMs: 5000}

describe('TerminalSession', () => {
  it('writes text and reads it back', async () => {
    const s = makeSession()
    await s.writeText('echo hello-session\n', SETTLE)
    const win = s.read(s.term.rows, 0)
    expect(win.text.some(line => line.includes('hello-session'))).toBe(true)
  })

  it('normalizes \\n to \\r so newlines submit', async () => {
    const s = makeSession()
    await s.writeText("printf 'one two'\n", SETTLE)
    const win = s.read(s.term.rows, 0)
    expect(win.text.some(line => /one two/.test(line))).toBe(true)
  })

  it('Ctrl+C aborts a running command (exit 130)', async () => {
    const s = makeSession()
    await s.writeText('sleep 30\n', {idleMs: 100, maxWaitMs: 500})
    await new Promise(r => setTimeout(r, 100))
    await s.pressKey('Ctrl+C', 1, {idleMs: 200, maxWaitMs: 3000})
    await s.writeText('echo aborted=$?\n', SETTLE)
    const win = s.read(s.term.rows, 0)
    expect(win.text.some(line => /aborted=130/.test(line))).toBe(true)
  })

  it('resize updates both PTY and emulator', async () => {
    const s = makeSession()
    await s.resize(60, 18)
    expect(s.term.cols).toBe(60)
    expect(s.term.rows).toBe(18)
    expect(s.pty.cols).toBe(60)
    expect(s.pty.rows).toBe(18)
    await s.writeText('stty size\n', SETTLE)
    const win = s.read(s.term.rows, 0)
    expect(win.text.some(line => /\b18 60\b/.test(line))).toBe(true)
  })

  it('partial resize preserves the other dimension', async () => {
    const s = makeSession()
    const beforeRows = s.term.rows
    await s.resize(50, undefined)
    expect(s.term.cols).toBe(50)
    expect(s.term.rows).toBe(beforeRows)
  })

  it('soft reset preserves PID, wipes buffer', async () => {
    const s = makeSession()
    const pid = s.pty.pid
    await s.writeText('echo before-reset\n', SETTLE)
    await s.softReset()
    expect(s.pty.pid).toBe(pid)
    const win = s.read(s.term.rows, 0)
    const joined = win.text.join('\n')
    expect(joined).not.toMatch(/before-reset/)
  })

  it('hard reset replaces the shell with a new PID', async () => {
    const s = makeSession()
    const pid = s.pty.pid
    await s.hardReset({})
    expect(s.pty.pid).not.toBe(pid)
  })

  it('hard reset with cwd override starts there', async () => {
    const s = makeSession()
    await s.hardReset({cwd: '/tmp'})
    await s.writeText('pwd\n', SETTLE)
    const win = s.read(s.term.rows, 0)
    expect(win.text.some(line => line.includes('/tmp'))).toBe(true)
  })

  it('dispose makes future calls throw', () => {
    const s = makeSession()
    s.dispose()
    active = null
    expect(() => s.read(10, 0)).toThrow()
  })
})
