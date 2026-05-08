import {describe, expect, it} from 'vitest'

import {HARD_CAP_MS, type SettleSource, waitSettled} from '../../src/emulator/settle.js'

interface FakeSource extends SettleSource {
  emit(chunk: string): void
  listenerCount(): number
}

function fakeSource(): FakeSource {
  const listeners: Array<(d: string) => void> = []
  return {
    onData(cb) {
      listeners.push(cb)
      return {
        dispose() {
          const i = listeners.indexOf(cb)
          if (i >= 0) listeners.splice(i, 1)
        }
      }
    },
    emit(chunk) {
      for (const cb of [...listeners]) cb(chunk)
    },
    listenerCount() {
      return listeners.length
    }
  }
}

describe('waitSettled', () => {
  it('returns deferred when maxWaitMs > HARD_CAP_MS', async () => {
    const src = fakeSource()
    const result = await waitSettled(src, {idleMs: 200, maxWaitMs: HARD_CAP_MS + 1})
    expect(result.outcome).toBe('deferred')
    expect(result.elapsedMs).toBe(0)
    expect(result.bytesObserved).toBe(0)
  })

  it('resolves to settled when no data arrives within initial wait', async () => {
    const src = fakeSource()
    const start = Date.now()
    const result = await waitSettled(src, {idleMs: 50, maxWaitMs: 5000})
    const elapsed = Date.now() - start
    expect(result.outcome).toBe('settled')
    expect(result.bytesObserved).toBe(0)
    expect(elapsed).toBeLessThan(2000)
  })

  it('resets idle timer on each chunk', async () => {
    const src = fakeSource()
    const promise = waitSettled(src, {idleMs: 100, maxWaitMs: 5000})
    await new Promise(r => setTimeout(r, 30))
    src.emit('chunk1')
    await new Promise(r => setTimeout(r, 30))
    src.emit('chunk2')
    const result = await promise
    expect(result.outcome).toBe('settled')
    expect(result.bytesObserved).toBe('chunk1chunk2'.length)
  })

  it('resolves to timeout when chunks never stop', async () => {
    const src = fakeSource()
    const promise = waitSettled(src, {idleMs: 5000, maxWaitMs: 250})
    const interval = setInterval(() => src.emit('x'), 20)
    const result = await promise
    clearInterval(interval)
    expect(result.outcome).toBe('timeout')
    expect(result.bytesObserved).toBeGreaterThan(0)
  })

  it('detaches listener on completion', async () => {
    const src = fakeSource()
    expect(src.listenerCount()).toBe(0)
    const promise = waitSettled(src, {idleMs: 50, maxWaitMs: 1000})
    expect(src.listenerCount()).toBe(1)
    await promise
    expect(src.listenerCount()).toBe(0)
  })
})
