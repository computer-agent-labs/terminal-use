import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js'
import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js'

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

export interface TerminalUseServer {
  server: McpServer
  /** Kill every session and remove the attach sockets. Idempotent. */
  dispose: () => void
}

export function createMcpServer(options: CreateOptions = {}): McpServer {
  return createTerminalUseServer(options).server
}

export function createTerminalUseServer(options: CreateOptions = {}): TerminalUseServer {
  const server = new McpServer(
    {
      name: 'terminal-use',
      title: 'terminal-use MCP server',
      version: VERSION
    },
    {capabilities: {}}
  )

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

  const registerOne = (tool: (typeof TOOLS)[number]) => {
    const handler = async (
      params: Record<string, unknown>,
      extra?: {signal?: AbortSignal}
    ): Promise<CallToolResult> => {
      const response = new McpResponse()
      const request = {params: params as never, signal: extra?.signal}
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(server.registerTool as any)(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.schema,
        annotations: tool.annotations
      },
      handler
    )
  }

  for (const tool of TOOLS) {
    registerOne(tool)
  }

  const dispose = () => context.dispose()
  // Closing the MCP connection ends the sessions' reason to exist — kill
  // the shells and unlink the attach sockets rather than leaking them.
  server.server.onclose = dispose

  // No process-level signal handlers here — the bin entrypoint installs
  // them and calls dispose(). Tests would accumulate listeners across many
  // createMcpServer calls if we registered any at this level.
  return {server, dispose}
}
