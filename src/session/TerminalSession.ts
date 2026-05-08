import type {Terminal} from '@xterm/headless'

import {windowMath, type Window} from '../emulator/pagination.js'
import {ptyAsSource, waitSettled, type SettleOptions, type SettleResult} from '../emulator/settle.js'
import {bufferState, createTerminal, type BufferState} from '../emulator/terminal.js'
import {keyToBytes} from '../pty/keys.js'
import {defaultShell, spawnPty, type IPty} from '../pty/spawn.js'

export interface ExitInfo {
  exitCode: number
  signal?: number
  at: Date
}

export interface SessionConfig {
  shell?: string
  cwd?: string
  cols: number
  rows: number
  scrollback?: number
}

export interface ReadWindow {
  text: string[]
  window: Window
  state: BufferState
}

export class TerminalSession {
  #pty!: IPty
  #term!: Terminal
  #config: SessionConfig
  #pendingFlushes: Array<Promise<void>> = []
  #disposed = false
  #exited: ExitInfo | undefined

  constructor(config: SessionConfig) {
    this.#config = {
      shell: config.shell ?? defaultShell(),
      cwd: config.cwd ?? process.cwd(),
      cols: config.cols,
      rows: config.rows,
      scrollback: config.scrollback ?? 5000
    }
    this.#spawn()
  }

  #spawn(): void {
    this.#exited = undefined
    this.#term = createTerminal({
      cols: this.#config.cols,
      rows: this.#config.rows,
      scrollback: this.#config.scrollback
    })
    this.#pty = spawnPty({
      shell: this.#config.shell,
      cwd: this.#config.cwd,
      cols: this.#config.cols,
      rows: this.#config.rows
    })
    const myPty = this.#pty
    this.#pty.onData(chunk => {
      if (this.#pty !== myPty) return
      const flush = new Promise<void>(resolve => this.#term.write(chunk, () => resolve()))
      this.#pendingFlushes.push(flush)
    })
    this.#term.onData(chunk => {
      if (this.#pty !== myPty) return
      this.#pty.write(chunk)
    })
    this.#pty.onExit(({exitCode, signal}) => {
      // Ignore exit events from a pty that was already replaced (e.g. via
      // hardReset) — only the currently-active pty's exit should be tracked.
      if (this.#pty !== myPty) return
      this.#exited = {exitCode, signal, at: new Date()}
    })
  }

  get pty(): IPty {
    this.#assertAlive()
    return this.#pty
  }

  get term(): Terminal {
    this.#assertAlive()
    return this.#term
  }

  get config(): Readonly<SessionConfig> {
    return this.#config
  }

  get exited(): ExitInfo | undefined {
    return this.#exited
  }

  get isAlive(): boolean {
    return !this.#disposed && !this.#exited
  }

  #assertAlive(): void {
    if (this.#disposed) throw new Error('TerminalSession has been disposed')
  }

  /**
   * Wait for the freshly-spawned shell to print its prompt and settle. Used
   * after auto-respawn so the next tool call doesn't race the prompt redraw.
   */
  async waitForReady(): Promise<void> {
    this.#assertAlive()
    await waitSettled(ptyAsSource(this.#pty), {idleMs: 200, maxWaitMs: 3000})
    await this.flush()
  }

  async flush(): Promise<void> {
    while (this.#pendingFlushes.length > 0) {
      const pending = this.#pendingFlushes
      this.#pendingFlushes = []
      await Promise.all(pending)
    }
  }

  async writeText(text: string, settle: SettleOptions): Promise<SettleResult> {
    this.#assertAlive()
    const normalized = text.replace(/\r\n|\n/g, '\r')
    const settler = waitSettled(ptyAsSource(this.#pty), settle)
    this.#pty.write(normalized)
    const result = await settler
    await this.flush()
    return result
  }

  async pressKey(spec: string, count: number, settle: SettleOptions): Promise<SettleResult> {
    this.#assertAlive()
    const sequence = keyToBytes(spec)
    const payload = count <= 1 ? sequence : sequence.repeat(count)
    const settler = waitSettled(ptyAsSource(this.#pty), settle)
    this.#pty.write(payload)
    const result = await settler
    await this.flush()
    return result
  }

  async resize(cols: number | undefined, rows: number | undefined): Promise<{cols: number; rows: number}> {
    this.#assertAlive()
    const newCols = cols ?? this.#term.cols
    const newRows = rows ?? this.#term.rows
    if (newCols === this.#term.cols && newRows === this.#term.rows) {
      return {cols: newCols, rows: newRows}
    }
    this.#pty.resize(newCols, newRows)
    this.#term.resize(newCols, newRows)
    this.#config = {...this.#config, cols: newCols, rows: newRows}
    return {cols: newCols, rows: newRows}
  }

  async softReset(): Promise<void> {
    this.#assertAlive()
    this.#term.reset()
    this.#term.clear()
    // Nudge the shell to print a fresh prompt — without this, the cleared
    // screen stays blank until the agent presses something, and they may
    // assume the shell is dead. Submitting an empty line (`\r`) is the most
    // portable trigger: bash/zsh/sh all redraw their prompt for it.
    const settler = waitSettled(ptyAsSource(this.#pty), {idleMs: 200, maxWaitMs: 2000})
    this.#pty.write('\r')
    await settler
    await this.flush()
  }

  async hardReset(overrides: {cols?: number; rows?: number; shell?: string; cwd?: string}): Promise<void> {
    this.#assertAlive()
    const oldPty = this.#pty
    const oldTerm = this.#term
    this.#config = {
      ...this.#config,
      cols: overrides.cols ?? this.#config.cols,
      rows: overrides.rows ?? this.#config.rows,
      shell: overrides.shell ?? this.#config.shell,
      cwd: overrides.cwd ?? this.#config.cwd
    }
    this.#pendingFlushes = []
    this.#spawn()
    try {
      oldPty.kill()
    } catch {
      // pty may already be dead
    }
    oldTerm.dispose()
  }

  read(rows: number, page: number): ReadWindow {
    this.#assertAlive()
    const buf = this.#term.buffer.active
    const win = windowMath(buf.length, page, rows)
    const text: string[] = []
    if (buf.length === 0 || win.end < win.start) {
      return {text, window: win, state: bufferState(this.#term)}
    }
    for (let y = win.start; y <= win.end; y++) {
      const line = buf.getLine(y)
      text.push(line ? line.translateToString(true) : '')
    }
    while (text.length > 0 && text[text.length - 1] === '') {
      text.pop()
    }
    return {text, window: win, state: bufferState(this.#term)}
  }

  state(): BufferState {
    this.#assertAlive()
    return bufferState(this.#term)
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    try {
      this.#pty.kill()
    } catch {
      // already dead
    }
    this.#term.dispose()
  }
}
