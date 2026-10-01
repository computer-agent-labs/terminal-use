import {describe, expect, it} from 'vitest'

import {markCursor} from '../../src/mcp/tools/shared.js'

describe('markCursor', () => {
  it('inserts in front of the character under the cursor, keeping it', () => {
    expect(markCursor('hello', {index: 1, length: 1})).toBe('h▌ello')
    expect(markCursor('hello', {index: 0, length: 1})).toBe('▌hello')
  })

  it('never splits a multi-code-unit character', () => {
    expect(markCursor('a🎉b', {index: 1, length: 2})).toBe('a▌🎉b')
  })

  it('puts the block marker in place of a blank cell inside the line', () => {
    expect(markCursor('ab  cd', {index: 2, length: 0})).toBe('ab▌ cd')
  })

  it('appends the block marker at end of line', () => {
    expect(markCursor('hello', {index: 5, length: 0})).toBe('hello▌')
  })

  it('pads when the cursor sits beyond the trimmed text', () => {
    expect(markCursor('hi', {index: 5, length: 0})).toBe('hi   ▌')
    expect(markCursor('', {index: 0, length: 0})).toBe('▌')
  })
})
