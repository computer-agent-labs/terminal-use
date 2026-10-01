import {McpServer, type CallToolResult, type ServerContext} from '@modelcontextprotocol/server'
import {z} from 'zod'

import {McpContext, type ContextOptions, type RespawnReason} from './mcp/McpContext.js'
import {McpResponse} from './mcp/McpResponse.js'
import {Mutex} from './mcp/Mutex.js'
import {TOOLS} from './mcp/tools/index.js'
import {VERSION} from './version.js'

const SIGNAL_NAMES: Record<number, string> = {
  1: 'SIGHUP',
  2: 'SIGINT',
  3: 'SIGQUIT',
  6: 'SIGABRT',
  9: 'SIGKILL',
  11: 'SIGSEGV',
  13: 'SIGPIPE',
  14: 'SIGALRM',
  15: 'SIGTERM'
}

function tag(sessionId: number, label?: string): string {
  return label ? `Session ${sessionId} ("${label}")` : `Session ${sessionId}`
}

function formatRespawnNotice(reason: RespawnReason, sessionId: number): string {
  const head = tag(sessionId, reason.label)
  const tail =
    'A fresh shell has been spawned (reusing the same sessionId) and is ready for new commands — ' +
    "re-issue your command if it's still relevant."
  switch (reason.kind) {
    case 'shell-exit': {
      const parts = [`exit code ${reason.exit.exitCode}`]
      if (reason.exit.signal !== undefined) {
        parts.push(`signal ${SIGNAL_NAMES[reason.exit.signal] ?? reason.exit.signal}`)
      }
      const screen = reason.finalScreen?.length
        ? `\n\nLast screen before the shell exited:\n---\n${reason.finalScreen.join('\n')}\n---`
        : ''
      return `${head}'s shell exited (${parts.join(', ')}) at ${reason.exit.at.toISOString()} between calls. ${tail}${screen}`
    }
    case 'idle-killed':
      return `${head} was terminated due to inactivity at ${reason.at.toISOString()}. ${tail}`
    case 'evicted':
      return `${head} was evicted at ${reason.at.toISOString()} because the session cap was reached and this was the least-recently-used session. ${tail}`
  }
}

export type CreateOptions = ContextOptions

// Sent to the client once per connection and usually placed in the model's
// context ahead of any tool call — the place for cross-tool guidance that no
// single tool description can carry.
const INSTRUCTIONS = [
  'terminal-use drives real terminals: each session is a shell on its own PTY, rendered by a terminal emulator, ' +
    'so what you read is what a person at that terminal would see (full-screen TUIs included).',
  'Workflow: terminal_create returns a sessionId; pass it to every other tool. Sessions outlive individual ' +
    'calls and are independent of each other, so several can be driven in parallel.',
  'terminal_type and terminal_press return the screen once output has been quiet for a moment (capped at 10s). ' +
    'For anything slower — builds, installs, test runs, servers starting — follow up with terminal_wait rather ' +
    'than sleeping or polling terminal_read.',
  'Prefer terminal_read (exact text, cheap) to understand the screen; use terminal_screenshot when colors, ' +
    'layout or styling matter.',
  'If a call reports that the session was respawned (shell exited, idle, evicted), the command you sent was ' +
    'NOT run: a fresh shell is waiting, so re-issue it if still wanted.',
  'Call terminal_destroy when you are finished with a session.'
].join('\n')

const PROGRESS_INTERVAL_FLOOR_MS = 1000

export interface TerminalUse {
  /**
   * Build an MCP server exposing the terminal tools. May be called more
   * than once (the stdio entry builds one per connection, and a throwaway
   * one for a discovery probe): every server shares the same sessions.
   */
  buildServer: () => McpServer
  /** Kill every session and remove the attach sockets. Idempotent. */
  dispose: () => void
}

export function createTerminalUse(options: CreateOptions = {}): TerminalUse {
  // MCP itself is stateless as of protocol revision 2026-07-28: no
  // handshake, no protocol-level session. Terminals are anything but, so
  // their state lives here, outside any one server instance, and is
  // addressed the way the spec prescribes — by an explicit handle
  // (`sessionId`) passed as an ordinary tool argument.
  const context = new McpContext(options)
  // One lock per session: calls against the same terminal stay strictly
  // ordered, but a slow settle or wait on one session never blocks another.
  const locks = new Map<number, Mutex>()
  const lockFor = (sessionId: number): Mutex => {
    let lock = locks.get(sessionId)
    if (!lock) {
      lock = new Mutex()
      locks.set(sessionId, lock)
    }
    return lock
  }

  const run = async (
    tool: (typeof TOOLS)[number],
    params: Record<string, unknown>,
    ctx: ServerContext
  ): Promise<CallToolResult> => {
    const response = new McpResponse()
    const request = {params: params as never, signal: ctx.mcpReq.signal, progress: progressReporter(ctx)}
    // Session-management tools carry a sessionId too (terminal_destroy);
    // lock on it so a destroy can't land in the middle of another call.
    const sessionId = typeof params.sessionId === 'number' ? params.sessionId : undefined
    const release = sessionId === undefined ? undefined : await lockFor(sessionId).acquire()
    try {
      if (tool.needsSession === false) {
        await tool.handler(request, response, context)
      } else if (sessionId === undefined) {
        response.setError(
          `Tool ${tool.name} requires \`sessionId\`. Call terminal_create first to allocate one, ` +
            'or terminal_list to enumerate currently-known ids.'
        )
      } else {
        const prep = await context.prepareForCall(sessionId)
        if (prep.respawned) {
          response.setError(formatRespawnNotice(prep.respawned, prep.sessionId))
        } else {
          await context.runWithSession(sessionId, () => tool.handler(request, response, context))
        }
      }
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message + (err.cause instanceof Error ? `\nCause: ${err.cause.message}` : '')
          : String(err)
      response.setError(`Error in ${tool.name}: ${message}`)
    } finally {
      release?.()
      if (sessionId !== undefined && !context.knows(sessionId)) locks.delete(sessionId)
    }
    return response.build()
  }

  const buildServer = (): McpServer => {
    const server = new McpServer(
      {
        name: 'terminal-use',
        title: 'terminal-use',
        version: VERSION
      },
      {capabilities: {tools: {}}, instructions: INSTRUCTIONS}
    )
    // TOOLS is sorted by name: tools/list order is deterministic, which
    // the spec asks for so clients (and prompt caches) can rely on it.
    for (const tool of TOOLS) {
      server.registerTool(
        tool.name,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: z.object(tool.schema),
          annotations: tool.annotations
        },
        (params, ctx) => run(tool, params as Record<string, unknown>, ctx)
      )
    }
    return server
  }

  // No process-level signal handlers here — the bin entrypoint installs
  // them and calls dispose(). Tests would accumulate listeners across many
  // createTerminalUse calls if we registered any at this level.
  return {buildServer, dispose: () => context.dispose()}
}

/**
 * Progress notifications for long calls (terminal_wait). Only when the
 * client asked for them by sending a progress token; they double as a
 * keep-alive for clients that reset their request timeout on progress.
 */
function progressReporter(ctx: ServerContext): ((message: string) => void) | undefined {
  const token = ctx.mcpReq._meta?.progressToken
  if (token === undefined) return undefined
  let count = 0
  let lastAt = 0
  return message => {
    const now = Date.now()
    if (now - lastAt < PROGRESS_INTERVAL_FLOOR_MS) return
    lastAt = now
    ctx.mcpReq
      .notify({method: 'notifications/progress', params: {progressToken: token, progress: ++count, message}})
      .catch(() => undefined)
  }
}
