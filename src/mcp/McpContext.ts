import {TerminalSession, type SessionConfig} from '../session/TerminalSession.js'

export interface ContextDefaults {
  cols: number
  rows: number
  scrollback: number
}

export const DEFAULT_DEFAULTS: ContextDefaults = {
  cols: 120,
  rows: 30,
  scrollback: 5000
}

export class McpContext {
  #session: TerminalSession | undefined
  #defaults: ContextDefaults

  constructor(defaults: ContextDefaults = DEFAULT_DEFAULTS) {
    this.#defaults = defaults
  }

  getSession(): TerminalSession {
    if (!this.#session) {
      this.#session = new TerminalSession({
        cols: this.#defaults.cols,
        rows: this.#defaults.rows,
        scrollback: this.#defaults.scrollback
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
        shell: overrides.shell,
        cwd: overrides.cwd,
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
