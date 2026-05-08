import {TerminalSession, type SessionConfig} from '../session/TerminalSession.js'

export interface ContextDefaults {
  cols: number
  rows: number
  scrollback: number
  shell?: string
  cwd?: string
}

export const DEFAULT_DEFAULTS: ContextDefaults = {
  cols: 120,
  rows: 30,
  scrollback: 5000
}

export class McpContext {
  #session: TerminalSession | undefined
  #defaults: ContextDefaults

  constructor(defaults: Partial<ContextDefaults> = {}) {
    this.#defaults = {
      cols: defaults.cols ?? DEFAULT_DEFAULTS.cols,
      rows: defaults.rows ?? DEFAULT_DEFAULTS.rows,
      scrollback: defaults.scrollback ?? DEFAULT_DEFAULTS.scrollback,
      shell: defaults.shell,
      cwd: defaults.cwd
    }
  }

  get defaults(): Readonly<ContextDefaults> {
    return this.#defaults
  }

  getSession(): TerminalSession {
    if (!this.#session) {
      this.#session = new TerminalSession({
        cols: this.#defaults.cols,
        rows: this.#defaults.rows,
        scrollback: this.#defaults.scrollback,
        shell: this.#defaults.shell,
        cwd: this.#defaults.cwd
      })
    }
    return this.#session
  }

  hasSession(): boolean {
    return this.#session !== undefined
  }

  async hardReset(overrides: Partial<SessionConfig>): Promise<TerminalSession> {
    if (!this.#session) {
      this.#session = new TerminalSession({
        cols: overrides.cols ?? this.#defaults.cols,
        rows: overrides.rows ?? this.#defaults.rows,
        shell: overrides.shell ?? this.#defaults.shell,
        cwd: overrides.cwd ?? this.#defaults.cwd,
        scrollback: this.#defaults.scrollback
      })
      return this.#session
    }
    await this.#session.hardReset(overrides)
    return this.#session
  }

  dispose(): void {
    if (this.#session) {
      this.#session.dispose()
      this.#session = undefined
    }
  }
}
