import {TerminalSession, type ExitInfo, type SessionConfig} from '../session/TerminalSession.js'

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

  /**
   * Called once per tool invocation, before the handler runs. Lazy-creates
   * the session, and if the previous shell has exited since the last call,
   * disposes it and spawns a fresh one (returning the exit info so the
   * handler can surface a notice to the agent and skip the action).
   */
  async prepareForCall(): Promise<{respawned?: ExitInfo}> {
    if (!this.#session) {
      this.#session = new TerminalSession({
        cols: this.#defaults.cols,
        rows: this.#defaults.rows,
        scrollback: this.#defaults.scrollback,
        shell: this.#defaults.shell,
        cwd: this.#defaults.cwd
      })
      return {}
    }
    if (this.#session.exited) {
      const previousExit = this.#session.exited
      this.#session.dispose()
      this.#session = new TerminalSession({
        cols: this.#defaults.cols,
        rows: this.#defaults.rows,
        scrollback: this.#defaults.scrollback,
        shell: this.#defaults.shell,
        cwd: this.#defaults.cwd
      })
      await this.#session.waitForReady()
      return {respawned: previousExit}
    }
    return {}
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
