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
      return `${head}'s shell exited (${parts.join(', ')}) at ${reason.exit.at.toISOString()} between calls. ${tail}`
    }
    case 'idle-killed':
      return `${head} was terminated due to inactivity at ${reason.at.toISOString()}. ${tail}`
    case 'evicted':
      return `${head} was evicted at ${reason.at.toISOString()} because the session cap was reached and this was the least-recently-used session. ${tail}`
  }
}

export type CreateOptions = ContextOptions

export function createMcpServer(options: CreateOptions = {}): McpServer {
  const server = new McpServer(
    {
      name: 'terminal-use',
      title: 'terminal-use MCP server',
      version: VERSION
    },
    {capabilities: {}}
  )

  const context = new McpContext(options)
  const mutex = new Mutex()

  const registerOne = (tool: (typeof TOOLS)[number]) => {
    const handler = async (params: Record<string, unknown>): Promise<CallToolResult> => {
      const release = await mutex.acquire()
      const response = new McpResponse()
      try {
        if (tool.needsSession === false) {
          await tool.handler({params: params as never}, response, context)
        } else {
          if (typeof params.sessionId !== 'number') {
            response.setError(
              `Tool ${tool.name} requires \`sessionId\`. Call terminal_create first to allocate one, ` +
                'or terminal_list to enumerate currently-known ids.'
            )
          } else {
            const prep = await context.prepareForCall(params.sessionId as number)
            if (prep.respawned) {
              response.setError(formatRespawnNotice(prep.respawned, prep.sessionId))
            } else {
              try {
                await tool.handler({params: params as never}, response, context)
              } finally {
                context.clearActiveCall()
              }
            }
          }
        }
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message + (err.cause instanceof Error ? `\nCause: ${err.cause.message}` : '')
            : String(err)
        response.setError(`Error in ${tool.name}: ${message}`)
      } finally {
        release()
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

  // No process-level signal handlers — when our process exits, the kernel
  // closes the PTY which delivers SIGHUP to the shell, cleaning up the
  // child tree without us doing anything explicit. Tests would accumulate
  // listeners across many createMcpServer calls if we registered any here.
  return server
}
