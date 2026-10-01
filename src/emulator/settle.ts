import type {IPty} from '../pty/spawn.js'

export const HARD_CAP_MS = 10000

export interface SettleOptions {
  idleMs: number
  maxWaitMs: number
}

export type SettleOutcome = 'settled' | 'timeout'

export interface SettleResult {
  outcome: SettleOutcome
  elapsedMs: number
  bytesObserved: number
  /** True when the caller asked for more than HARD_CAP_MS and we clamped. */
  capped: boolean
}

export interface SettleSource {
  onData(cb: (data: string) => void): {dispose(): void}
}

export function ptyAsSource(pty: IPty): SettleSource {
  return {
    onData(cb) {
      return pty.onData(cb)
    }
  }
}

export function waitSettled(source: SettleSource, options: SettleOptions): Promise<SettleResult> {
  const start = Date.now()
  // type/press/click hold a tool call open, so they never wait longer than
  // the cap. Anything slower belongs in terminal_wait.
  const capped = options.maxWaitMs > HARD_CAP_MS
  const maxWaitMs = Math.min(options.maxWaitMs, HARD_CAP_MS)

  return new Promise<SettleResult>(resolve => {
    let bytes = 0
    let firstArrived = false
    let idleTimer: NodeJS.Timeout | null = null
    let maxTimer: NodeJS.Timeout | null = null

    const cleanup = () => {
      if (idleTimer) clearTimeout(idleTimer)
      if (maxTimer) clearTimeout(maxTimer)
      disposable.dispose()
    }

    const finish = (outcome: SettleOutcome) => {
      cleanup()
      resolve({outcome, elapsedMs: Date.now() - start, bytesObserved: bytes, capped})
    }

    const noActivityMs = Math.min(maxWaitMs, Math.max(options.idleMs * 4, 1000))

    const disposable = source.onData(chunk => {
      bytes += chunk.length
      if (!firstArrived) firstArrived = true
      if (idleTimer) clearTimeout(idleTimer)
      idleTimer = setTimeout(() => finish('settled'), options.idleMs)
    })

    idleTimer = setTimeout(() => finish('settled'), noActivityMs)
    maxTimer = setTimeout(() => finish(firstArrived ? 'timeout' : 'settled'), maxWaitMs)
  })
}
