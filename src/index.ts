import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js'
import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js'

import {McpContext, type ContextDefaults} from './mcp/McpContext.js'
import {McpResponse} from './mcp/McpResponse.js'
import {Mutex} from './mcp/Mutex.js'
import {TOOLS} from './mcp/tools/index.js'
import type {ExitInfo} from './session/TerminalSession.js'
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

function formatRespawnNotice(exit: ExitInfo, sessionId: number): string {
  const parts = [`exit code ${exit.exitCode}`]
  if (exit.signal !== undefined) {
    parts.push(`signal ${SIGNAL_NAMES[exit.signal] ?? exit.signal}`)
  }
  return (
    `Session ${sessionId}'s shell exited (${parts.join(', ')}) at ${exit.at.toISOString()} between ` +
    'the last call and this one. A fresh shell has been spawned (reusing the same sessionId) and is ' +
    "ready for new commands — re-issue your command if it's still relevant."
  )
}

export interface CreateOptions {
  defaults?: Partial<ContextDefaults>
}

export function createMcpServer(options: CreateOptions = {}): McpServer {
  const server = new McpServer(
    {
      name: 'terminal-use',
      title: 'terminal-use MCP server',
      version: VERSION
    },
    {capabilities: {}}
  )

  const context = new McpContext(options.defaults)
  const mutex = new Mutex()

  const registerOne = (tool: (typeof TOOLS)[number]) => {
    const handler = async (params: Record<string, unknown>): Promise<CallToolResult> => {
      const release = await mutex.acquire()
      const response = new McpResponse()
      try {
        if (tool.needsSession === false) {
          await tool.handler({params: params as never}, response, context)
        } else {
          const sessionId =
            typeof params.sessionId === 'number' ? (params.sessionId as number) : undefined
          const prep = await context.prepareForCall(sessionId)
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
