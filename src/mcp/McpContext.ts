import {TerminalSession, type ExitInfo} from '../session/TerminalSession.js'

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

export interface CreateSessionOptions {
  label?: string
  cols?: number
  rows?: number
  scrollback?: number
  shell?: string
  cwd?: string
}

export interface SessionDescriptor {
  sessionId: number
  label?: string
  pid: number
  cols: number
  rows: number
  shell: string
  cwd: string
  isCurrent: boolean
  isAlive: boolean
  exitedAt?: Date
  exitCode?: number
  exitSignal?: number
}

export interface PrepareResult {
  sessionId: number
  respawned?: ExitInfo
}

export class McpContext {
  #sessions = new Map<number, TerminalSession>()
  #labels = new Map<number, string>()
  #currentId: number | undefined
  #nextId = 1
  #activeForCall: number | undefined
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

  get currentId(): number | undefined {
    return this.#currentId
  }

  /** The session bound to the in-flight tool call. Throws if not set. */
  session(): TerminalSession {
    if (this.#activeForCall === undefined) {
      throw new Error('No active session for this call (call prepareForCall first).')
    }
    const s = this.#sessions.get(this.#activeForCall)
    if (!s) {
      throw new Error(`Session ${this.#activeForCall} no longer exists.`)
    }
    return s
  }

  /** The session id bound to the in-flight tool call. */
  activeId(): number {
    if (this.#activeForCall === undefined) {
      throw new Error('No active session for this call.')
    }
    return this.#activeForCall
  }

  labelOf(id: number): string | undefined {
    return this.#labels.get(id)
  }

  /**
   * Resolve the session for a tool call. If `sessionId` is given it must
   * exist (else throws). If omitted, the current default is used; if there
   * is no current default, one is lazy-created. If the resolved session has
   * a dead shell, it is auto-respawned in place (preserving its sessionId)
   * and the previous exit info is returned so the caller can surface a
   * notice.
   */
  async prepareForCall(sessionId?: number): Promise<PrepareResult> {
    let id: number
    if (sessionId !== undefined) {
      if (!this.#sessions.has(sessionId)) {
        throw new Error(
          `Unknown sessionId ${sessionId}. Known: ${Array.from(this.#sessions.keys()).join(', ') || '(none)'}.`
        )
      }
      id = sessionId
    } else if (this.#currentId !== undefined && this.#sessions.has(this.#currentId)) {
      id = this.#currentId
    } else {
      id = this.#allocId()
      const s = this.#spawn({})
      this.#sessions.set(id, s)
      this.#currentId = id
      this.#activeForCall = id
      return {sessionId: id}
    }

    const existing = this.#sessions.get(id)!
    if (existing.exited) {
      const previousExit = existing.exited
      const oldLabel = this.#labels.get(id)
      existing.dispose()
      const fresh = this.#spawn({})
      this.#sessions.set(id, fresh)
      if (oldLabel) this.#labels.set(id, oldLabel)
      await fresh.waitForReady()
      this.#activeForCall = id
      return {sessionId: id, respawned: previousExit}
    }

    this.#activeForCall = id
    return {sessionId: id}
  }

  clearActiveCall(): void {
    this.#activeForCall = undefined
  }

  createSession(opts: CreateSessionOptions): SessionDescriptor {
    const id = this.#allocId()
    const session = this.#spawn(opts)
    this.#sessions.set(id, session)
    if (opts.label) this.#labels.set(id, opts.label)
    if (this.#currentId === undefined) this.#currentId = id
    return this.#describe(id)
  }

  selectSession(id: number): SessionDescriptor {
    if (!this.#sessions.has(id)) {
      throw new Error(`Unknown sessionId ${id}.`)
    }
    this.#currentId = id
    return this.#describe(id)
  }

  destroySession(id: number): SessionDescriptor {
    const s = this.#sessions.get(id)
    if (!s) throw new Error(`Unknown sessionId ${id}.`)
    const desc = this.#describe(id)
    s.dispose()
    this.#sessions.delete(id)
    this.#labels.delete(id)
    if (this.#currentId === id) {
      // Pick any remaining session as the new current, or unset.
      const next = this.#sessions.keys().next()
      this.#currentId = next.done ? undefined : next.value
    }
    return desc
  }

  listSessions(): SessionDescriptor[] {
    return Array.from(this.#sessions.keys()).map(id => this.#describe(id))
  }

  /** True if at least one session has ever been created. */
  hasSessions(): boolean {
    return this.#sessions.size > 0
  }

  dispose(): void {
    for (const s of this.#sessions.values()) {
      try {
        s.dispose()
      } catch {
        // ignore
      }
    }
    this.#sessions.clear()
    this.#labels.clear()
    this.#currentId = undefined
    this.#activeForCall = undefined
  }

  #allocId(): number {
    return this.#nextId++
  }

  #spawn(opts: CreateSessionOptions): TerminalSession {
    return new TerminalSession({
      cols: opts.cols ?? this.#defaults.cols,
      rows: opts.rows ?? this.#defaults.rows,
      scrollback: opts.scrollback ?? this.#defaults.scrollback,
      shell: opts.shell ?? this.#defaults.shell,
      cwd: opts.cwd ?? this.#defaults.cwd
    })
  }

  #describe(id: number): SessionDescriptor {
    const s = this.#sessions.get(id)
    if (!s) throw new Error(`Unknown sessionId ${id}.`)
    const exit = s.exited
    return {
      sessionId: id,
      label: this.#labels.get(id),
      pid: s.pty.pid,
      cols: s.term.cols,
      rows: s.term.rows,
      shell: s.config.shell ?? '',
      cwd: s.config.cwd ?? '',
      isCurrent: this.#currentId === id,
      isAlive: s.isAlive,
      exitedAt: exit?.at,
      exitCode: exit?.exitCode,
      exitSignal: exit?.signal
    }
  }
}
