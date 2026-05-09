import {describe, expect, it} from 'vitest'

import {McpResponse, sanitizeUnicode} from '../../src/mcp/McpResponse.js'

describe('sanitizeUnicode', () => {
  it('passes plain ASCII through unchanged', () => {
    expect(sanitizeUnicode('hello world')).toBe('hello world')
  })

  it('passes BMP non-ASCII through unchanged', () => {
    expect(sanitizeUnicode('café 你好 ▌')).toBe('café 你好 ▌')
  })

  it('preserves valid surrogate pairs (supplementary-plane chars like emoji)', () => {
    const emoji = '🎉' // U+1F389, encoded as 🎉 in UTF-16
    expect(sanitizeUnicode(emoji)).toBe(emoji)
    expect(sanitizeUnicode('party 🎉 time')).toBe('party 🎉 time')
  })

  it('replaces lone high surrogates with U+FFFD', () => {
    expect(sanitizeUnicode('\uD800')).toBe('�')
    expect(sanitizeUnicode('a\uD800b')).toBe('a�b')
    expect(sanitizeUnicode('\uDBFF')).toBe('�')
  })

  it('replaces lone low surrogates with U+FFFD', () => {
    expect(sanitizeUnicode('\uDC00')).toBe('�')
    expect(sanitizeUnicode('a\uDFFFb')).toBe('a�b')
  })

  it('replaces multiple lone surrogates in one string', () => {
    expect(sanitizeUnicode('\uD800x\uDC00y\uD801')).toBe('�x�y�')
  })

  it('handles a lone high followed by a non-surrogate', () => {
    // \uD800 then 'a' — lone, replace.
    expect(sanitizeUnicode('\uD800a')).toBe('�a')
  })

  it('handles a high surrogate followed by another high (both lone)', () => {
    expect(sanitizeUnicode('\uD800\uD801')).toBe('��')
  })

  it('preserves a paired surrogate immediately followed by a lone one', () => {
    // 🎉 = 🎉 (paired), then \uD800 alone.
    const input = '🎉\uD800'
    expect(sanitizeUnicode(input)).toBe('🎉�')
  })

  it('produces JSON-stringifiable output for inputs with lone surrogates', () => {
    const dirty = 'before\uD800after'
    const clean = sanitizeUnicode(dirty)
    // The serialized form should not contain a lone surrogate escape;
    // every \uXXXX in the output should either be a paired surrogate or
    // a non-surrogate code point. Easiest check: round-trip through JSON
    // and assert it matches.
    const roundTripped = JSON.parse(JSON.stringify(clean))
    expect(roundTripped).toBe(clean)
    // And the serialized JSON must be valid UTF-8 byte-encodable
    // (Buffer.from uses WHATWG encoder which throws on lone surrogates).
    expect(() => Buffer.from(JSON.stringify(clean), 'utf8')).not.toThrow()
  })
})

describe('McpResponse.build sanitizes', () => {
  it('strips lone surrogates from text content', () => {
    const r = new McpResponse()
    r.appendLine('hello \uD800 world')
    const built = r.build()
    const block = built.content[0] as {type: string; text: string}
    expect(block.text).toBe('hello � world')
  })

  it('strips lone surrogates from structuredContent recursively', () => {
    const r = new McpResponse()
    r.appendLine('placeholder')
    r.setStructured({nested: {arr: ['ok', 'bad\uD800']}, key: 'fine'})
    const built = r.build()
    const struct = built.structuredContent as {nested: {arr: string[]}; key: string}
    expect(struct.nested.arr[1]).toBe('bad�')
  })

  it('preserves emoji and other valid Unicode in text content', () => {
    const r = new McpResponse()
    r.appendLine('valid 🎉 你好 ▌')
    const built = r.build()
    const block = built.content[0] as {type: string; text: string}
    expect(block.text).toBe('valid 🎉 你好 ▌')
  })
})
