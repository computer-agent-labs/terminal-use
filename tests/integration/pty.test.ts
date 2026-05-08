import {describe, expect, it} from 'vitest'

import {spawnPty} from '../../src/pty/spawn.js'

describe('spawnPty', () => {
  it('spawns sh, captures stdout, reports exit code', async () => {
    const pty = spawnPty({shell: '/bin/sh', cwd: process.cwd(), cols: 80, rows: 24})
    let chunks = ''
    pty.onData(c => {
      chunks += c
    })
    const exitInfo = await new Promise<{exitCode: number; signal?: number}>(resolve => {
      pty.onExit(info => resolve(info))
      pty.write('echo hi-from-pty\n')
      setTimeout(() => pty.write('exit 7\n'), 100)
    })
    expect(chunks).toMatch(/hi-from-pty/)
    expect(exitInfo.exitCode).toBe(7)
  })

  it('survives kill', async () => {
    const pty = spawnPty({shell: '/bin/sh', cwd: process.cwd(), cols: 80, rows: 24})
    const exit = new Promise<void>(resolve => {
      pty.onExit(() => resolve())
    })
    pty.kill()
    await exit
  })

  it('respects cwd', async () => {
    const pty = spawnPty({shell: '/bin/sh', cwd: '/tmp', cols: 80, rows: 24})
    let chunks = ''
    pty.onData(c => {
      chunks += c
    })
    const exit = new Promise<void>(resolve => {
      pty.onExit(() => resolve())
    })
    pty.write('pwd\n')
    setTimeout(() => pty.write('exit\n'), 100)
    await exit
    expect(chunks).toMatch(/\/tmp/)
  })
})
