import {describe, expect, it} from 'vitest'

import {shellArgs, shellFamily} from '../../src/pty/spawn.js'

describe('shellFamily', () => {
  it('recognizes PowerShell and cmd by file name, whatever the path or case', () => {
    expect(shellFamily('powershell.exe')).toBe('powershell')
    expect(shellFamily('C:\\Program Files\\PowerShell\\7\\pwsh.exe')).toBe('powershell')
    expect(shellFamily('C:\\Windows\\System32\\CMD.EXE')).toBe('cmd')
  })

  it('treats everything else as a POSIX shell', () => {
    expect(shellFamily('/bin/zsh')).toBe('posix')
    expect(shellFamily('C:\\Program Files\\Git\\bin\\bash.exe')).toBe('posix')
  })
})

describe('shellArgs', () => {
  it('starts POSIX shells bare, with -l for a login shell and -c for a command', () => {
    expect(shellArgs('/bin/bash', undefined, false)).toEqual([])
    expect(shellArgs('/bin/bash', undefined, true)).toEqual(['-l'])
    expect(shellArgs('/bin/bash', 'echo hi', true)).toEqual(['-l', '-c', 'echo hi'])
  })

  it('runs a cmd.exe command with /c', () => {
    expect(shellArgs('cmd.exe', 'dir', false)).toEqual(['/d', '/s', '/c', 'dir'])
    expect(shellArgs('cmd.exe', undefined, true)).toEqual([])
  })

  it('runs a PowerShell command so that its exit code survives', () => {
    expect(shellArgs('powershell.exe', undefined, false)).toEqual(['-NoLogo'])
    const args = shellArgs('pwsh.exe', 'npm test', false)
    expect(args.slice(0, 2)).toEqual(['-NoLogo', '-Command'])
    expect(args[2]).toContain('& { npm test }')
    expect(args[2]).toContain('exit $LASTEXITCODE')
  })
})
