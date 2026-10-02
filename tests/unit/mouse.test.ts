import {describe, expect, it} from 'vitest'

import {leftClickSequence, wheelSequence} from '../../src/pty/mouse.js'

describe('leftClickSequence', () => {
  it('produces the SGR press+release pair for left button at the given cell', () => {
    expect(leftClickSequence(5, 10)).toBe('\x1b[<0;5;10M\x1b[<0;5;10m')
  })

  it('emits 1-indexed coordinates verbatim (no off-by-one)', () => {
    expect(leftClickSequence(1, 1)).toBe('\x1b[<0;1;1M\x1b[<0;1;1m')
  })

  it('handles large coordinates (SGR has no 223-cell ceiling)', () => {
    expect(leftClickSequence(500, 300)).toBe('\x1b[<0;500;300M\x1b[<0;500;300m')
  })

  it('falls back to legacy X10 bytes when the program did not enable SGR mode', () => {
    // 32 + button(0), 32 + col, 32 + row; release reports button 3.
    expect(leftClickSequence(5, 10, false)).toBe('\x1b[M %*\x1b[M#%*')
  })

  it('refuses legacy coordinates that would not survive as single bytes', () => {
    expect(() => leftClickSequence(120, 3, false)).toThrow(/legacy mouse encoding/)
  })

  it('press uses uppercase M, release uses lowercase m', () => {
    const seq = leftClickSequence(7, 3)
    const press = seq.slice(0, seq.indexOf('M') + 1)
    const release = seq.slice(seq.indexOf('M') + 1)
    expect(press.endsWith('M')).toBe(true)
    expect(release.endsWith('m')).toBe(true)
  })
})

describe('wheelSequence', () => {
  it('sends wheel-up as button 64 and wheel-down as 65, press only', () => {
    expect(wheelSequence('up', 10, 5)).toBe('\x1b[<64;10;5M')
    expect(wheelSequence('down', 10, 5)).toBe('\x1b[<65;10;5M')
  })

  it('has a legacy encoding with the same single-byte limit as clicks', () => {
    expect(wheelSequence('up', 1, 1, false)).toBe('\x1b[M`!!')
    expect(() => wheelSequence('down', 200, 1, false)).toThrow(/legacy mouse encoding/)
  })
})
