import {describe, expect, it} from 'vitest'

import {keyToBytes, parseKeySpec} from '../../src/pty/keys.js'

describe('parseKeySpec', () => {
  it('parses a bare key', () => {
    expect(parseKeySpec('Enter')).toEqual({ctrl: false, alt: false, shift: false, meta: false, base: 'Enter'})
  })

  it('parses a single modifier', () => {
    expect(parseKeySpec('Ctrl+C')).toEqual({ctrl: true, alt: false, shift: false, meta: false, base: 'C'})
  })

  it('parses multiple modifiers in any order', () => {
    expect(parseKeySpec('Ctrl+Shift+ArrowLeft').base).toBe('ArrowLeft')
    const p = parseKeySpec('Shift+Ctrl+ArrowLeft')
    expect(p).toEqual({ctrl: true, alt: false, shift: true, meta: false, base: 'ArrowLeft'})
  })

  it('aliases modifier names', () => {
    const p1 = parseKeySpec('Control+A')
    const p2 = parseKeySpec('Option+B')
    const p3 = parseKeySpec('Cmd+K')
    expect(p1.ctrl).toBe(true)
    expect(p2.alt).toBe(true)
    expect(p3.meta).toBe(true)
  })

  it('throws on empty input', () => {
    expect(() => parseKeySpec('')).toThrow()
  })

  it('throws on unknown modifier', () => {
    expect(() => parseKeySpec('Hyper+A')).toThrow(/Unknown modifier/i)
  })
})

describe('keyToBytes - named keys', () => {
  it('Enter → \\r', () => {
    expect(keyToBytes('Enter')).toBe('\r')
  })

  it('Tab → \\t', () => {
    expect(keyToBytes('Tab')).toBe('\t')
  })

  it('Shift+Tab → CSI Z', () => {
    expect(keyToBytes('Shift+Tab')).toBe('\x1b[Z')
  })

  it('Escape → ESC', () => {
    expect(keyToBytes('Escape')).toBe('\x1b')
  })

  it('Backspace → DEL', () => {
    expect(keyToBytes('Backspace')).toBe('\x7f')
  })

  it('Alt+Backspace → ESC + DEL', () => {
    expect(keyToBytes('Alt+Backspace')).toBe('\x1b\x7f')
  })

  it('Space → " "', () => {
    expect(keyToBytes('Space')).toBe(' ')
  })

  it('Ctrl+Space → NUL', () => {
    expect(keyToBytes('Ctrl+Space')).toBe('\x00')
  })
})

describe('keyToBytes - arrows', () => {
  it.each([
    ['ArrowUp', '\x1b[A'],
    ['ArrowDown', '\x1b[B'],
    ['ArrowRight', '\x1b[C'],
    ['ArrowLeft', '\x1b[D'],
    ['Home', '\x1b[H'],
    ['End', '\x1b[F']
  ])('%s → %s', (key, expected) => {
    expect(keyToBytes(key)).toBe(expected)
  })

  it('Ctrl+ArrowLeft → CSI 1;5 D', () => {
    expect(keyToBytes('Ctrl+ArrowLeft')).toBe('\x1b[1;5D')
  })

  it('Shift+ArrowUp → CSI 1;2 A', () => {
    expect(keyToBytes('Shift+ArrowUp')).toBe('\x1b[1;2A')
  })

  it('Ctrl+Shift+ArrowRight → CSI 1;6 C', () => {
    expect(keyToBytes('Ctrl+Shift+ArrowRight')).toBe('\x1b[1;6C')
  })

  it('Up alias works', () => {
    expect(keyToBytes('Up')).toBe('\x1b[A')
  })
})

describe('keyToBytes - tilde keys', () => {
  it.each([
    ['Insert', '\x1b[2~'],
    ['Delete', '\x1b[3~'],
    ['PageUp', '\x1b[5~'],
    ['PageDown', '\x1b[6~'],
    ['F5', '\x1b[15~'],
    ['F6', '\x1b[17~'],
    ['F12', '\x1b[24~']
  ])('%s → %s', (key, expected) => {
    expect(keyToBytes(key)).toBe(expected)
  })

  it('Ctrl+PageUp → CSI 5;5 ~', () => {
    expect(keyToBytes('Ctrl+PageUp')).toBe('\x1b[5;5~')
  })
})

describe('keyToBytes - F1..F4', () => {
  it.each([
    ['F1', '\x1bOP'],
    ['F2', '\x1bOQ'],
    ['F3', '\x1bOR'],
    ['F4', '\x1bOS']
  ])('%s → %s', (key, expected) => {
    expect(keyToBytes(key)).toBe(expected)
  })

  it('Shift+F1 → CSI 1;2 P', () => {
    expect(keyToBytes('Shift+F1')).toBe('\x1b[1;2P')
  })
})

describe('keyToBytes - Ctrl+letter', () => {
  it.each([
    ['Ctrl+A', '\x01'],
    ['Ctrl+C', '\x03'],
    ['Ctrl+D', '\x04'],
    ['Ctrl+L', '\x0c'],
    ['Ctrl+Z', '\x1a']
  ])('%s → control byte', (key, expected) => {
    expect(keyToBytes(key)).toBe(expected)
  })

  it('case-insensitive on the letter', () => {
    expect(keyToBytes('Ctrl+c')).toBe('\x03')
    expect(keyToBytes('CTRL+C')).toBe('\x03')
  })

  it('full A..Z roundtrip', () => {
    for (let i = 0; i < 26; i++) {
      const letter = String.fromCharCode('A'.charCodeAt(0) + i)
      expect(keyToBytes(`Ctrl+${letter}`)).toBe(String.fromCharCode(i + 1))
    }
  })
})

describe('keyToBytes - Alt+letter', () => {
  it('Alt+B → ESC b', () => {
    expect(keyToBytes('Alt+B')).toBe('\x1bb')
  })

  it('Alt+Shift+B → ESC B', () => {
    expect(keyToBytes('Alt+Shift+B')).toBe('\x1bB')
  })
})

describe('keyToBytes - Ctrl+punctuation', () => {
  it.each([
    ['Ctrl+@', '\x00'],
    ['Ctrl+[', '\x1b'],
    ['Ctrl+\\', '\x1c'],
    ['Ctrl+]', '\x1d'],
    ['Ctrl+^', '\x1e'],
    ['Ctrl+_', '\x1f'],
    ['Ctrl+?', '\x7f']
  ])('%s → control byte', (key, expected) => {
    expect(keyToBytes(key)).toBe(expected)
  })
})

describe('keyToBytes - errors', () => {
  it('rejects bare letter (use terminal_type)', () => {
    expect(() => keyToBytes('a')).toThrow(/terminal_type/)
  })

  it('rejects unknown key', () => {
    expect(() => keyToBytes('NotARealKey')).toThrow(/Unknown key/i)
  })

  it('rejects empty', () => {
    expect(() => keyToBytes('')).toThrow()
  })
})
