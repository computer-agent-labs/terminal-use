import {existsSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {afterEach, beforeEach, describe, expect, it} from 'vitest'

import {findSockets} from '../../src/attach/client.js'

// A pid that cannot be alive: far above any platform's pid_max.
const DEAD_PID = 2 ** 30

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'terminal-use-find-'))
})

afterEach(() => {
  rmSync(dir, {recursive: true, force: true})
})

describe('findSockets', () => {
  it('returns sockets of running servers for the requested session only', () => {
    const mine = join(dir, `terminal-use-${process.pid}-3.sock`)
    writeFileSync(mine, '')
    writeFileSync(join(dir, `terminal-use-${process.pid}-13.sock`), '')
    expect(findSockets(3, dir)).toEqual([mine])
  })

  it('reports every running server that has the session, so the caller can refuse to guess', () => {
    writeFileSync(join(dir, `terminal-use-${process.pid}-1.sock`), '')
    writeFileSync(join(dir, `terminal-use-${process.ppid}-1.sock`), '')
    expect(findSockets(1, dir)).toHaveLength(2)
  })

  it('skips and deletes sockets left behind by servers that are gone', () => {
    const stale = join(dir, `terminal-use-${DEAD_PID}-1.sock`)
    const staleOther = join(dir, `terminal-use-${DEAD_PID}-2.sock`)
    writeFileSync(stale, '')
    writeFileSync(staleOther, '')
    expect(findSockets(1, dir)).toEqual([])
    expect(existsSync(stale)).toBe(false)
    expect(existsSync(staleOther)).toBe(false)
  })
})
