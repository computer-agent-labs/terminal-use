import {execFile} from 'node:child_process'

import type {Terminal} from '@xterm/headless'

import {findHighlights, type Highlights} from '../emulator/highlights.js'
import {windowMath, type Window} from '../emulator/pagination.js'
import {ptyAsSource, waitSettled, type SettleOptions, type SettleResult} from '../emulator/settle.js'
import {
  bufferState,
  createTerminal,
  isSgrMouseEnabled,
  resetTrackedModes,
  serializeTerminal,
  type BufferState
} from '../emulator/terminal.js'
import {keyToBytes} from '../pty/keys.js'
import {leftClickSequence, wheelSequence, type WheelDirection} from '../pty/mouse.js'
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
  /** Command line to run instead of an interactive shell. */
  command?: string
  /** Extra environment variables for the process. */
  env?: Record<string, string>
  /** Start the shell as a login shell. */
  login?: boolean
}

export interface ReadWindow {
  text: string[]
  window: Window
  state: BufferState
  /** Where the cursor falls in its line of `text`. */
  cursor: CursorInText
  /** Index into `text` of the line holding the cursor; -1 if it is outside the window. */
  cursorLine: number
  /** How many soft-wrapped rows were joined onto the line before them. */
  joined: number
  /** Text the program is drawing attention to; absent if not asked for. */
  highlights?: Highlights
}

export interface ReadOptions {
  /**
   * Join rows the terminal soft-wrapped at its right edge back into the
   * single line the program printed. Default true.
   */
  joinWrapped?: boolean
  /** Report highlighted (reverse-video / background-colored) text on the screen. Default true. */
  highlights?: boolean
}

export interface CursorInText {
  /**
   * String index of the cursor's cell within its line. Differs from
   * `state.cursorCol` (a cell index) whenever the line holds wide or
   * multi-code-unit characters to the left of the cursor, or earlier
   * soft-wrapped rows were joined in front of it.
   */
  index: number
  /** Code units of the character under the cursor; 0 if the cell is blank. */
  length: number
}

/**
 * What currently owns the terminal's foreground:
 *  - 'shell'   the session's shell itself — it is sitting at its prompt.
 *  - 'command' a child of the shell (a running command or TUI).
 *  - 'unknown' could not be determined (Windows, no `ps`, shell gone).
 */
export type ForegroundState = 'shell' | 'command' | 'unknown'

const FLUSH_CAP_MS = 500
const PASTE_START = '\x1b[200~'
const PASTE_END = '\x1b[201~'

export class TerminalSession {
  #pty!: IPty
  #term!: Terminal
  #config: SessionConfig
  #pendingWrites = 0
  #drainWaiters: Array<() => void> = []
  #finalScreen: string[] | undefined
  #disposed = false
  #exited: ExitInfo | undefined
  #exitListeners: Array<(info: ExitInfo) => void> = []
  #dataListeners: Array<(chunk: string) => void> = []

  constructor(config: SessionConfig) {
    this.#config = {
      shell: config.shell ?? defaultShell(),
      cwd: config.cwd ?? process.cwd(),
      cols: config.cols,
      rows: config.rows,
      scrollback: config.scrollback ?? 5000,
      command: config.command,
      env: config.env,
      login: config.login ?? false
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
      rows: this.#config.rows,
      command: this.#config.command,
      env: this.#config.env,
      login: this.#config.login
    })
    const myPty = this.#pty
    const myTerm = this.#term
    this.#pty.onData(chunk => {
      if (this.#pty !== myPty) return
      // xterm parses asynchronously. Count outstanding writes rather than
      // keeping a promise per chunk — a chatty process nobody is reading
      // would otherwise grow that list without bound.
      this.#pendingWrites++
      myTerm.write(chunk, () => {
        if (this.#term !== myTerm) return
        this.#pendingWrites--
        if (this.#pendingWrites === 0) this.#resolveDrainWaiters()
      })
      // Fan out the raw PTY bytes to any extra subscribers (e.g. an
      // AttachServer broadcasting to attached human clients). Same
      // bytes that hit the emulator — order-of-arrival preserved.
      if (this.#dataListeners.length > 0) {
        for (const cb of [...this.#dataListeners]) {
          try {
            cb(chunk)
          } catch {
            // listener errors must not break the pty event loop
          }
        }
      }
    })
    this.#term.onData(chunk => {
      if (this.#pty !== myPty) return
      this.#pty.write(chunk)
    })
    this.#pty.onExit(({exitCode, signal}) => {
      // Ignore exit events from a pty that was already replaced (e.g. via
      // hardReset) — only the currently-active pty's exit should be tracked.
      if (this.#pty !== myPty) return
      const info = {exitCode, signal, at: new Date()}
      this.#exited = info
      const notify = () => {
        if (this.#pty !== myPty || this.#disposed) return
        // Listeners typically dispose us, so grab the last screen first —
        // it's often the only clue to why the shell died.
        this.#finalScreen = this.#captureScreen()
        for (const cb of [...this.#exitListeners]) {
          try {
            cb(info)
          } catch {
            // listener errors must not break the pty event loop
          }
        }
      }
      // Let the emulator finish parsing the shell's last output before
      // anyone snapshots or disposes it.
      if (this.#pendingWrites === 0) notify()
      else void this.flush().then(notify)
    })
  }

  #resolveDrainWaiters(): void {
    const waiters = this.#drainWaiters
    this.#drainWaiters = []
    for (const resolve of waiters) resolve()
  }

  #captureScreen(): string[] {
    const buf = this.#term.buffer.active
    const lines: string[] = []
    for (let y = buf.baseY; y < buf.baseY + this.#term.rows; y++) {
      lines.push(buf.getLine(y)?.translateToString(true) ?? '')
    }
    while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
    return lines
  }

  /**
   * The screen as it looked when the shell exited. Available once the
   * shell is gone, and kept after dispose().
   */
  get finalScreen(): string[] | undefined {
    if (this.#finalScreen) return this.#finalScreen
    if (this.#exited && !this.#disposed) return this.#captureScreen()
    return undefined
  }

  onExit(cb: (info: ExitInfo) => void): () => void {
    this.#exitListeners.push(cb)
    return () => {
      const i = this.#exitListeners.indexOf(cb)
      if (i >= 0) this.#exitListeners.splice(i, 1)
    }
  }

  onData(cb: (chunk: string) => void): () => void {
    this.#dataListeners.push(cb)
    return () => {
      const i = this.#dataListeners.indexOf(cb)
      if (i >= 0) this.#dataListeners.splice(i, 1)
    }
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

  /**
   * True when the session runs one command rather than an interactive
   * shell. Such a session is finished once the command exits: its screen
   * stays readable, but nothing respawns it behind the caller's back.
   */
  get isCommand(): boolean {
    return this.#config.command !== undefined
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

  /**
   * Wait until the emulator has parsed every byte received from the pty so
   * far. Capped: under a flood (or if the terminal is disposed mid-wait and
   * its write callbacks never fire) we return rather than hang the caller.
   */
  async flush(): Promise<void> {
    if (this.#disposed || this.#pendingWrites === 0) return
    let timer: NodeJS.Timeout | undefined
    await Promise.race([
      new Promise<void>(resolve => this.#drainWaiters.push(resolve)),
      new Promise<void>(resolve => {
        timer = setTimeout(resolve, FLUSH_CAP_MS)
      })
    ])
    clearTimeout(timer)
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

  /**
   * Deliver `text` as one paste rather than as keystrokes. Programs that
   * asked for bracketed paste (editors, REPLs, modern shells) get it wrapped
   * in the paste markers, so they insert it verbatim — no auto-indent, no
   * running each line as it arrives. Others get the plain characters, which
   * is all a real terminal would send them too.
   */
  async paste(text: string, settle: SettleOptions): Promise<SettleResult & {bracketed: boolean}> {
    this.#assertAlive()
    const bracketed = this.#term.modes.bracketedPasteMode
    // The end marker inside the payload would close the paste early and let
    // the rest through as live keystrokes.
    const body = text.replace(/\r\n|\n/g, '\r').replaceAll(PASTE_END, '')
    const settler = waitSettled(ptyAsSource(this.#pty), settle)
    this.#pty.write(bracketed ? PASTE_START + body + PASTE_END : body)
    const result = await settler
    await this.flush()
    return {...result, bracketed}
  }

  async pressKey(spec: string, count: number, settle: SettleOptions): Promise<SettleResult> {
    this.#assertAlive()
    const sequence = keyToBytes(spec, {applicationCursor: this.#term.modes.applicationCursorKeysMode})
    const payload = count <= 1 ? sequence : sequence.repeat(count)
    const settler = waitSettled(ptyAsSource(this.#pty), settle)
    this.#pty.write(payload)
    const result = await settler
    await this.flush()
    return result
  }

  /**
   * Whether the program currently in the foreground has opted into mouse
   * tracking (any non-'none' mode). Reflects the latest DECSET state seen
   * by the emulator — set when the program prints `\x1b[?1000h` /
   * `\x1b[?1002h` / etc., reset when it prints the matching DECRST.
   */
  isMouseModeEnabled(): boolean {
    return this.#term.modes.mouseTrackingMode !== 'none'
  }

  async sendLeftClick(col: number, row: number, settle: SettleOptions): Promise<SettleResult> {
    this.#assertAlive()
    const sequence = leftClickSequence(col, row, isSgrMouseEnabled(this.#term))
    const settler = waitSettled(ptyAsSource(this.#pty), settle)
    this.#pty.write(sequence)
    const result = await settler
    await this.flush()
    return result
  }

  /**
   * Turn the mouse wheel `amount` notches at (col, row), the way a terminal
   * emulator would:
   *  - the program tracks the mouse → it gets wheel events;
   *  - it doesn't, but is on the alternate screen (less, man, older TUIs) →
   *    the wheel becomes arrow keys, which is what terminals do there;
   *  - a plain shell → nothing to deliver; the wheel would scroll the
   *    terminal's own scrollback, which is read with terminal_read instead.
   */
  async scroll(
    direction: WheelDirection,
    amount: number,
    col: number,
    row: number,
    settle: SettleOptions
  ): Promise<SettleResult & {via: 'wheel' | 'arrows'}> {
    this.#assertAlive()
    let payload: string
    let via: 'wheel' | 'arrows'
    if (this.isMouseModeEnabled()) {
      via = 'wheel'
      payload = wheelSequence(direction, col, row, isSgrMouseEnabled(this.#term)).repeat(amount)
    } else if (this.#term.buffer.active.type === 'alternate') {
      via = 'arrows'
      const key = direction === 'up' ? 'ArrowUp' : 'ArrowDown'
      payload = keyToBytes(key, {applicationCursor: this.#term.modes.applicationCursorKeysMode}).repeat(amount)
    } else {
      throw new Error(
        'Nothing to scroll: the foreground program is not full-screen and has not enabled the mouse, so the ' +
          'wheel would only move the terminal\'s own scrollback. Read earlier output with terminal_read ' +
          '(`page: 1` is the screen before this one).'
      )
    }
    const settler = waitSettled(ptyAsSource(this.#pty), settle)
    this.#pty.write(payload)
    const result = await settler
    await this.flush()
    return {...result, via}
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
    resetTrackedModes(this.#term)
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
    this.#pendingWrites = 0
    this.#resolveDrainWaiters()
    this.#finalScreen = undefined
    this.#spawn()
    try {
      oldPty.kill()
    } catch {
      // pty may already be dead
    }
    oldTerm.dispose()
  }

  read(rows: number, page: number, options: ReadOptions = {}): ReadWindow {
    this.#assertAlive()
    const joinWrapped = options.joinWrapped ?? true
    const buf = this.#term.buffer.active
    const win = windowMath(buf.length, page, rows)
    const text: string[] = []
    const state = bufferState(this.#term)
    const empty: ReadWindow = {text, window: win, state, cursor: {index: 0, length: 0}, cursorLine: -1, joined: 0}
    if (buf.length === 0 || win.end < win.start) return empty

    const cursorRow = state.cursorRow
    const inRow = this.#cursorInRow()
    let cursor: CursorInText = {index: 0, length: 0}
    let cursorLine = -1
    let joined = 0
    for (let y = win.start; y <= win.end; y++) {
      // A row whose successor is flagged as wrapped is the first part of one
      // long line the terminal broke at its right edge. Stitch the parts
      // back together so the reader sees the line the program printed.
      let line = ''
      for (;;) {
        const continues = joinWrapped && y < win.end && buf.getLine(y + 1)?.isWrapped === true
        // Keep trailing blanks on every part but the last: they are real
        // columns, and dropping them would glue words together.
        const part = buf.getLine(y)?.translateToString(!continues) ?? ''
        if (y === cursorRow) {
          cursor = {index: line.length + inRow.index, length: inRow.length}
          cursorLine = text.length
        }
        line += part
        if (!continues) break
        joined++
        y++
      }
      text.push(line)
    }
    while (text.length > 0 && text[text.length - 1] === '' && text.length - 1 !== cursorLine) {
      text.pop()
    }
    const highlights =
      options.highlights === false ? undefined : findHighlights(this.#term, win.start, win.end)
    return {text, window: win, state, cursor, cursorLine, joined, highlights}
  }

  /** Map the cursor's cell column onto its row's translated text. */
  #cursorInRow(): CursorInText {
    const buf = this.#term.buffer.active
    const line = buf.getLine(buf.baseY + buf.cursorY)
    if (!line) return {index: buf.cursorX, length: 0}
    // On the trailing half of a wide character, the character it belongs
    // to starts one cell earlier.
    let col = buf.cursorX
    while (col > 0 && line.getCell(col)?.getWidth() === 0) col--
    let index = 0
    for (let x = 0; x < col; x++) {
      const cell = line.getCell(x)
      if (!cell) {
        index++
        continue
      }
      // Width-0 cells are the trailing half of a wide character and emit
      // nothing; empty cells emit a single space.
      if (cell.getWidth() === 0) continue
      index += cell.getChars().length || 1
    }
    const chars = line.getCell(col)?.getChars() ?? ''
    return {index, length: chars.trim() === '' ? 0 : chars.length}
  }

  /**
   * Escape-sequence replay of the current screen plus up to `scrollback`
   * lines of history — what a newly attached client needs to catch up.
   */
  serialize(scrollback: number): string {
    this.#assertAlive()
    return serializeTerminal(this.#term, scrollback)
  }

  /**
   * Ask the kernel which process group owns the pty's foreground. An
   * interactive shell puts each command in its own process group and hands
   * it the terminal, then takes it back when the command finishes — so
   * "foreground group == the shell's group" means the shell is at its
   * prompt. No shell integration or prompt parsing needed.
   */
  foreground(): Promise<ForegroundState> {
    if (this.#disposed || this.#exited || process.platform === 'win32') {
      return Promise.resolve('unknown')
    }
    return new Promise(resolve => {
      execFile('ps', ['-o', 'tpgid=,pgid=', '-p', String(this.#pty.pid)], (err, stdout) => {
        if (err) return resolve('unknown')
        const [tpgid, pgid] = stdout.trim().split(/\s+/).map(n => Number.parseInt(n, 10))
        if (!tpgid || !pgid || tpgid < 1) return resolve('unknown')
        resolve(tpgid === pgid ? 'shell' : 'command')
      })
    })
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
