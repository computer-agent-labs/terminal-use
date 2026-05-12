import {describe, expect, it} from 'vitest'

import {
  encodeData,
  encodeDetach,
  encodeResize,
  FRAME_DATA,
  FRAME_DETACH,
  FRAME_RESIZE,
  FrameDecoder,
  parseResize
} from '../../src/attach/framing.js'

describe('encode', () => {
  it('encodes DATA with the right header bytes', () => {
    const frame = encodeData('hi')
    expect(frame.readUInt8(0)).toBe(FRAME_DATA)
    expect(frame.readUInt32BE(1)).toBe(2)
    expect(frame.subarray(5).toString('utf8')).toBe('hi')
  })

  it('encodes RESIZE with "cols,rows" ASCII payload', () => {
    const frame = encodeResize(120, 40)
    expect(frame.readUInt8(0)).toBe(FRAME_RESIZE)
    expect(frame.subarray(5).toString('utf8')).toBe('120,40')
  })

  it('encodes DETACH with empty payload', () => {
    const frame = encodeDetach()
    expect(frame.readUInt8(0)).toBe(FRAME_DETACH)
    expect(frame.readUInt32BE(1)).toBe(0)
    expect(frame.length).toBe(5)
  })

  it('handles binary payloads (no UTF-8 assumption)', () => {
    const raw = Buffer.from([0x00, 0xff, 0xed, 0xa0, 0x80])
    const frame = encodeData(raw)
    expect(frame.subarray(5).equals(raw)).toBe(true)
  })
})

describe('FrameDecoder', () => {
  it('decodes a single complete frame', () => {
    const d = new FrameDecoder()
    const frames = d.push(encodeData('abc'))
    expect(frames).toHaveLength(1)
    expect(frames[0]!.type).toBe(FRAME_DATA)
    expect(frames[0]!.payload.toString('utf8')).toBe('abc')
    expect(d.bufferedBytes).toBe(0)
  })

  it('decodes multiple frames concatenated in one chunk', () => {
    const d = new FrameDecoder()
    const wire = Buffer.concat([encodeData('a'), encodeResize(80, 24), encodeDetach()])
    const frames = d.push(wire)
    expect(frames.map(f => f.type)).toEqual([FRAME_DATA, FRAME_RESIZE, FRAME_DETACH])
  })

  it('buffers a partial header and emits when the rest arrives', () => {
    const d = new FrameDecoder()
    const wire = encodeData('hello')
    const firstHalf = wire.subarray(0, 2)
    const secondHalf = wire.subarray(2)
    expect(d.push(firstHalf)).toHaveLength(0)
    expect(d.bufferedBytes).toBe(2)
    const frames = d.push(secondHalf)
    expect(frames).toHaveLength(1)
    expect(frames[0]!.payload.toString('utf8')).toBe('hello')
  })

  it('buffers a partial payload and emits when complete', () => {
    const d = new FrameDecoder()
    const wire = encodeData('partial-frame-payload')
    expect(d.push(wire.subarray(0, 7))).toHaveLength(0) // header + 2 payload bytes
    expect(d.push(wire.subarray(7, 13))).toHaveLength(0)
    const frames = d.push(wire.subarray(13))
    expect(frames).toHaveLength(1)
    expect(frames[0]!.payload.toString('utf8')).toBe('partial-frame-payload')
    expect(d.bufferedBytes).toBe(0)
  })

  it('handles a byte-by-byte stream', () => {
    const d = new FrameDecoder()
    const wire = Buffer.concat([encodeData('xy'), encodeData('z')])
    const out: string[] = []
    for (let i = 0; i < wire.length; i++) {
      const frames = d.push(wire.subarray(i, i + 1))
      for (const f of frames) out.push(f.payload.toString('utf8'))
    }
    expect(out).toEqual(['xy', 'z'])
  })

  it('reset clears the internal buffer', () => {
    const d = new FrameDecoder()
    d.push(Buffer.from([FRAME_DATA, 0x00, 0x00, 0x00])) // partial header
    expect(d.bufferedBytes).toBe(4)
    d.reset()
    expect(d.bufferedBytes).toBe(0)
  })
})

describe('parseResize', () => {
  it('parses valid payloads', () => {
    expect(parseResize(Buffer.from('80,24'))).toEqual({cols: 80, rows: 24})
    expect(parseResize(Buffer.from('1,1'))).toEqual({cols: 1, rows: 1})
  })

  it('rejects malformed payloads', () => {
    expect(parseResize(Buffer.from(''))).toBeUndefined()
    expect(parseResize(Buffer.from('80'))).toBeUndefined()
    expect(parseResize(Buffer.from('80,24,extra'))).toBeUndefined()
    expect(parseResize(Buffer.from('a,b'))).toBeUndefined()
    expect(parseResize(Buffer.from('0,24'))).toBeUndefined()
    expect(parseResize(Buffer.from('-1,24'))).toBeUndefined()
  })
})
