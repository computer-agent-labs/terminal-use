import {AsyncLocalStorage} from 'node:async_hooks'

import {AttachServer, socketPathFor} from '../attach/AttachServer.js'
import {DEFAULT_THEME_NAME, type ThemeName} from '../emulator/palette.js'
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

export const DEFAULT_MAX_SESSIONS = 50
export const DEFAULT_IDLE_KILL_MS = 6 * 60 * 60 * 1000
export const DEFAULT_TOMBSTONE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
export const DEFAULT_SWEEP_INTERVAL_MS = 30 * 60 * 1000

export interface ContextOptions {
  defaults?: Partial<ContextDefaults>
  /** Max concurrent live sessions; once full, terminal_create evicts LRU. Default 50. */
  maxSessions?: number
  /** Idle threshold; a session inactive this long is killed (and tombstoned). Default 6h. */
  idleKillMs?: number
  /** Tombstone retention; sessionId is reserved this long after inactivity/eviction. Default 30d. */
  tombstoneRetentionMs?: number
  /** Sweep interval; how often the context checks for idle/tombstone-GC. Default 30min. Set to 0 to disable. */
  sweepIntervalMs?: number
  /** Optional clock for tests. Default Date.now. */
  now?: () => number
  /** PID baked into attach-socket paths. Default process.pid; tests can override for determinism. */
  attachServerPid?: number
}

export interface CreateSessionOptions {
  label?: string
  cols?: number
  rows?: number
  scrollback?: number
  shell?: string
  cwd?: string
  theme?: ThemeName
  command?: string
  env?: Record<string, string>
}

export interface SessionDescriptor {
  sessionId: number
  label?: string
  pid: number
  cols: number
  rows: number
  shell: string
  cwd: string
  isAlive: boolean
  lastActivityAt: Date
  createdAt: Date
  theme: ThemeName
  /** Set for sessions that run one command instead of a shell. */
  command?: string
  /** Set once that command has exited. */
  exit?: ExitInfo
}

export interface TombstoneDescriptor {
  sessionId: number
  label?: string
  reason: 'shell-exit' | 'idle-killed' | 'evicted'
  at: Date
  expiresAt: Date
  exitCode?: number
  exitSignal?: number
}

export type RespawnReason =
  | {kind: 'shell-exit'; exit: ExitInfo; label?: string; finalScreen?: string[]}
  | {kind: 'idle-killed'; at: Date; label?: string}
  | {kind: 'evicted'; at: Date; label?: string}

export interface PrepareResult {
  sessionId: number
  respawned?: RespawnReason
}

interface SessionRecord {
  session: TerminalSession
  label?: string
  theme: ThemeName
  lastActivityAt: number
  createdAt: number
  unsubscribeExit: () => void
  unsubscribeData: () => void
}

interface Tombstone {
  reason: 'shell-exit' | 'idle-killed' | 'evicted'
  at: number
  label?: string
  theme: ThemeName
  /** Size, shell, cwd and scrollback the session had, so a respawn matches it. */
  config: SessionConfig
  exitInfo?: ExitInfo
  finalScreen?: string[]
}

export class McpContext {
  #sessions = new Map<number, SessionRecord>()
  #tombstones = new Map<number, Tombstone>()
  #attaches = new Map<number, AttachServer>()
  #nextId = 1
  // The session a tool call is bound to travels with that call's async
  // context, so calls against different sessions can overlap safely.
  #activeCall = new AsyncLocalStorage<number>()
  #defaults: ContextDefaults
  #maxSessions: number
  #idleKillMs: number
  #tombstoneRetentionMs: number
  #sweepInterval: NodeJS.Timeout | undefined
  #now: () => number
  #attachServerPid: number

  constructor(options: ContextOptions = {}) {
    this.#defaults = {
      cols: options.defaults?.cols ?? DEFAULT_DEFAULTS.cols,
      rows: options.defaults?.rows ?? DEFAULT_DEFAULTS.rows,
      scrollback: options.defaults?.scrollback ?? DEFAULT_DEFAULTS.scrollback,
      shell: options.defaults?.shell,
      cwd: options.defaults?.cwd
    }
    this.#maxSessions = options.maxSessions ?? DEFAULT_MAX_SESSIONS
    this.#idleKillMs = options.idleKillMs ?? DEFAULT_IDLE_KILL_MS
    this.#tombstoneRetentionMs = options.tombstoneRetentionMs ?? DEFAULT_TOMBSTONE_RETENTION_MS
    this.#now = options.now ?? Date.now
    this.#attachServerPid = options.attachServerPid ?? process.pid

    const sweepIntervalMs = options.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS
    if (sweepIntervalMs > 0) {
      this.#sweepInterval = setInterval(() => this.sweep(), sweepIntervalMs)
      this.#sweepInterval.unref?.()
    }
  }

  socketPathFor(sessionId: number): string {
    return socketPathFor(this.#attachServerPid, sessionId)
  }

  get defaults(): Readonly<ContextDefaults> {
    return this.#defaults
  }

  /** Run `fn` with `sessionId` as the session bound to this tool call. */
  runWithSession<T>(sessionId: number, fn: () => Promise<T>): Promise<T> {
    return this.#activeCall.run(sessionId, fn)
  }

  /** The session bound to the in-flight tool call. Throws if not set. */
  session(): TerminalSession {
    const rec = this.#sessions.get(this.activeId())
    if (!rec) {
      throw new Error(`Session ${this.activeId()} no longer exists.`)
    }
    return rec.session
  }

  activeId(): number {
    const id = this.#activeCall.getStore()
    if (id === undefined) {
      throw new Error('No active session for this call (use runWithSession).')
    }
    return id
  }

  labelOf(id: number): string | undefined {
    return this.#sessions.get(id)?.label ?? this.#tombstones.get(id)?.label
  }

  themeOf(id: number): ThemeName | undefined {
    return this.#sessions.get(id)?.theme ?? this.#tombstones.get(id)?.theme
  }

  /**
   * Resolve a session for a tool call. `sessionId` is required.
   *  - If a tombstone exists for that id (idle-killed, evicted, …) we
   *    respawn fresh under the same id and return the reason.
   *  - If the session exists but its shell exited, we respawn in place and
   *    return the exit info.
   *  - If alive, we just bump lastActivityAt.
   *  - If neither alive nor tombstoned, this throws.
   */
  async prepareForCall(sessionId: number): Promise<PrepareResult> {
    const tomb = this.#tombstones.get(sessionId)
    if (tomb?.config.command !== undefined) {
      // Never re-run a command on our own initiative.
      this.#tombstones.delete(sessionId)
      this.#closeAttach(sessionId)
      const what = tomb.reason === 'evicted' ? 'evicted to make room for newer sessions' : 'closed after sitting idle'
      throw new Error(
        `Session ${sessionId}${tomb.label ? ` ("${tomb.label}")` : ''} ran \`${tomb.config.command}\` and was ${what} ` +
          `at ${new Date(tomb.at).toISOString()}. It is gone and was not restarted — call terminal_create to run the command again.`
      )
    }
    if (tomb) {
      this.#tombstones.delete(sessionId)
      this.#enforceCapForRevival()
      const session = this.#spawn(tomb.config)
      const rec = this.#buildRecord(sessionId, session, tomb.label, tomb.theme)
      this.#sessions.set(sessionId, rec)
      await session.waitForReady()
      const respawned: RespawnReason =
        tomb.reason === 'shell-exit' && tomb.exitInfo
          ? {kind: 'shell-exit', exit: tomb.exitInfo, label: tomb.label, finalScreen: tomb.finalScreen}
          : tomb.reason === 'idle-killed'
            ? {kind: 'idle-killed', at: new Date(tomb.at), label: tomb.label}
            : {kind: 'evicted', at: new Date(tomb.at), label: tomb.label}
      return {sessionId, respawned}
    }

    const rec = this.#sessions.get(sessionId)
    if (!rec) {
      throw new Error(
        `Unknown sessionId ${sessionId}. Call terminal_create first, or check terminal_list for ` +
          'currently-known ids.'
      )
    }

    // The shell is gone but its exit hasn't been turned into a tombstone
    // yet (the session holds exit listeners back until the emulator has
    // parsed the last output). Respawn in place.
    if (rec.session.exited && !rec.session.isCommand) {
      const previousExit = rec.session.exited
      const finalScreen = rec.session.finalScreen
      rec.unsubscribeExit()
      rec.unsubscribeData()
      rec.session.dispose()
      const fresh = this.#spawn(rec.session.config)
      const newRec = this.#buildRecord(sessionId, fresh, rec.label, rec.theme)
      this.#sessions.set(sessionId, newRec)
      await fresh.waitForReady()
      return {
        sessionId,
        respawned: {kind: 'shell-exit', exit: previousExit, label: rec.label, finalScreen}
      }
    }

    rec.lastActivityAt = this.#now()
    return {sessionId}
  }

  /**
   * Build a SessionRecord and wire it to its AttachServer. The AttachServer
   * is created on first use (lazily) per sessionId, and survives across
   * respawn — so an attached human keeps their connection when the shell
   * dies and a new one is spawned in its place. Only fully destroyed when
   * terminal_destroy is called or the tombstone is GC'd.
   */
  #buildRecord(
    sessionId: number,
    session: TerminalSession,
    label: string | undefined,
    theme: ThemeName
  ): SessionRecord {
    let attach = this.#attaches.get(sessionId)
    if (!attach) {
      attach = new AttachServer(this.socketPathFor(sessionId))
      this.#attaches.set(sessionId, attach)
    }
    attach.setTarget(session)
    const rec: SessionRecord = {
      session,
      label,
      theme,
      lastActivityAt: this.#now(),
      createdAt: this.#now(),
      unsubscribeExit: () => undefined,
      unsubscribeData: () => undefined
    }
    rec.unsubscribeData = session.onData(chunk => {
      // Output counts as activity: a dev server or long build the agent
      // left running (or one a human is driving over attach) is not idle.
      rec.lastActivityAt = this.#now()
      attach!.broadcast(chunk)
    })
    rec.unsubscribeExit = session.onExit(info => this.#handleSessionExit(sessionId, info))
    return rec
  }

  createSession(opts: CreateSessionOptions): SessionDescriptor {
    if (this.#sessions.size >= this.#maxSessions) {
      this.#evictOldest()
    }
    const id = this.#nextId++
    const session = this.#spawn(opts)
    const rec = this.#buildRecord(id, session, opts.label, opts.theme ?? DEFAULT_THEME_NAME)
    this.#sessions.set(id, rec)
    return this.#describe(id)
  }

  destroySession(id: number): SessionDescriptor {
    const rec = this.#sessions.get(id)
    if (!rec) {
      // If it's a tombstone, treat destroy as "okay, forget it for real".
      const tomb = this.#tombstones.get(id)
      if (tomb) {
        this.#tombstones.delete(id)
        this.#closeAttach(id)
        return {
          sessionId: id,
          label: tomb.label,
          pid: 0,
          cols: 0,
          rows: 0,
          shell: '',
          cwd: '',
          isAlive: false,
          lastActivityAt: new Date(tomb.at),
          createdAt: new Date(tomb.at),
          theme: tomb.theme
        }
      }
      throw new Error(`Unknown sessionId ${id}.`)
    }
    const desc = this.#describe(id)
    rec.unsubscribeExit()
    rec.unsubscribeData()
    rec.session.dispose()
    this.#sessions.delete(id)
    this.#closeAttach(id)
    // Explicit destroy: do NOT tombstone. The agent said "kill it"; future
    // calls against this id should error rather than auto-respawn.
    return desc
  }

  #closeAttach(id: number): void {
    const attach = this.#attaches.get(id)
    if (attach) {
      try {
        attach.close()
      } catch {
        // ignore
      }
      this.#attaches.delete(id)
    }
  }

  listSessions(): SessionDescriptor[] {
    return Array.from(this.#sessions.keys()).map(id => this.#describe(id))
  }

  listTombstones(): TombstoneDescriptor[] {
    return Array.from(this.#tombstones.entries()).map(([id, t]) => ({
      sessionId: id,
      label: t.label,
      reason: t.reason,
      at: new Date(t.at),
      expiresAt: new Date(t.at + this.#tombstoneRetentionMs),
      exitCode: t.exitInfo?.exitCode,
      exitSignal: t.exitInfo?.signal
    }))
  }

  /** Whether `id` is a live session or a tombstone. */
  knows(id: number): boolean {
    return this.#sessions.has(id) || this.#tombstones.has(id)
  }

  hasSessions(): boolean {
    return this.#sessions.size > 0
  }

  /** Reset all in-process state — used when a fresh MCP client connects. */
  resetAll(): void {
    for (const rec of this.#sessions.values()) {
      rec.unsubscribeExit()
      rec.unsubscribeData()
      try {
        rec.session.dispose()
      } catch {
        // ignore
      }
    }
    for (const attach of this.#attaches.values()) {
      try {
        attach.close()
      } catch {
        // ignore
      }
    }
    this.#sessions.clear()
    this.#tombstones.clear()
    this.#attaches.clear()
  }

  /**
   * Run the idle-kill + tombstone-GC pass. Public so tests can advance
   * time and trigger a sweep manually instead of waiting on the interval.
   */
  sweep(): void {
    const now = this.#now()
    for (const [id, rec] of this.#sessions) {
      if (now - rec.lastActivityAt > this.#idleKillMs) {
        rec.unsubscribeExit()
        rec.unsubscribeData()
        try {
          rec.session.dispose()
        } catch {
          // ignore
        }
        this.#sessions.delete(id)
        this.#tombstones.set(id, {
          reason: 'idle-killed',
          at: now,
          label: rec.label,
          theme: rec.theme,
          config: rec.session.config
        })
        this.#attaches.get(id)?.setTarget(undefined)
      }
    }
    for (const [id, t] of this.#tombstones) {
      if (now - t.at > this.#tombstoneRetentionMs) {
        this.#tombstones.delete(id)
        this.#closeAttach(id)
      }
    }
  }

  dispose(): void {
    if (this.#sweepInterval) clearInterval(this.#sweepInterval)
    this.#sweepInterval = undefined
    this.resetAll()
  }

  #spawn(opts: Partial<SessionConfig>): TerminalSession {
    return new TerminalSession({
      cols: opts.cols ?? this.#defaults.cols,
      rows: opts.rows ?? this.#defaults.rows,
      scrollback: opts.scrollback ?? this.#defaults.scrollback,
      shell: opts.shell ?? this.#defaults.shell,
      cwd: opts.cwd ?? this.#defaults.cwd,
      command: opts.command,
      env: opts.env
    })
  }

  #handleSessionExit(id: number, info: ExitInfo): void {
    const rec = this.#sessions.get(id)
    if (!rec || rec.session.exited !== info) return
    // A command session is simply finished. Keep it — screen, exit status
    // and all — until the caller destroys it; respawning would mean running
    // the command a second time without being asked.
    if (rec.session.isCommand) return
    rec.unsubscribeExit()
    rec.unsubscribeData()
    try {
      rec.session.dispose()
    } catch {
      // ignore
    }
    this.#sessions.delete(id)
    this.#tombstones.set(id, {
      reason: 'shell-exit',
      at: info.at.getTime(),
      label: rec.label,
      theme: rec.theme,
      config: rec.session.config,
      exitInfo: info,
      finalScreen: rec.session.finalScreen
    })
    // Attach socket stays open — clients see output stop until the next
    // tool call against this id triggers a respawn. Target gets nulled so
    // any incoming bytes from attached clients are dropped.
    this.#attaches.get(id)?.setTarget(undefined)
  }

  #evictOldest(): void {
    let oldestId: number | undefined
    let oldestAt = Infinity
    for (const [id, rec] of this.#sessions) {
      if (rec.lastActivityAt < oldestAt) {
        oldestAt = rec.lastActivityAt
        oldestId = id
      }
    }
    if (oldestId === undefined) return
    const rec = this.#sessions.get(oldestId)!
    rec.unsubscribeExit()
    rec.unsubscribeData()
    try {
      rec.session.dispose()
    } catch {
      // ignore
    }
    this.#sessions.delete(oldestId)
    this.#tombstones.set(oldestId, {
      reason: 'evicted',
      at: this.#now(),
      label: rec.label,
      theme: rec.theme,
      config: rec.session.config
    })
    this.#attaches.get(oldestId)?.setTarget(undefined)
  }

  /**
   * Reviving a tombstone (via prepareForCall) shouldn't push us past the
   * cap. If we're already at or above the cap, evict the oldest live
   * session before bringing the tombstoned id back.
   */
  #enforceCapForRevival(): void {
    if (this.#sessions.size >= this.#maxSessions) {
      this.#evictOldest()
    }
  }

  #describe(id: number): SessionDescriptor {
    const rec = this.#sessions.get(id)
    if (!rec) throw new Error(`Unknown sessionId ${id}.`)
    return {
      sessionId: id,
      label: rec.label,
      pid: rec.session.pty.pid,
      cols: rec.session.term.cols,
      rows: rec.session.term.rows,
      shell: rec.session.config.shell ?? '',
      cwd: rec.session.config.cwd ?? '',
      isAlive: rec.session.isAlive,
      lastActivityAt: new Date(rec.lastActivityAt),
      createdAt: new Date(rec.createdAt),
      theme: rec.theme,
      command: rec.session.config.command,
      exit: rec.session.isCommand ? rec.session.exited : undefined
    }
  }
}
