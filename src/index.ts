import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js'
import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js'

import {McpContext} from './mcp/McpContext.js'
import {McpResponse} from './mcp/McpResponse.js'
import {Mutex} from './mcp/Mutex.js'
import {TOOLS} from './mcp/tools/index.js'
import {VERSION} from './version.js'

export function createMcpServer(): McpServer {
  const server = new McpServer(
    {
      name: 'terminal-use',
      title: 'terminal-use MCP server',
      version: VERSION
    },
    {capabilities: {}}
  )

  const context = new McpContext()
  const mutex = new Mutex()

  const registerOne = (tool: (typeof TOOLS)[number]) => {
    const handler = async (params: Record<string, unknown>): Promise<CallToolResult> => {
      const release = await mutex.acquire()
      const response = new McpResponse()
      try {
        await tool.handler({params: params as never}, response, context)
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

  const cleanup = () => {
    context.dispose()
  }
  process.once('SIGINT', cleanup)
  process.once('SIGTERM', cleanup)
  process.once('exit', cleanup)

  return server
}
