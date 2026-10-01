import {z, type ZodRawShape} from 'zod'

import type {McpContext} from './McpContext.js'
import type {McpResponse} from './McpResponse.js'

export interface ToolAnnotations {
  title?: string
  readOnlyHint?: boolean
}

export interface ToolDefinition<Schema extends ZodRawShape = ZodRawShape> {
  name: string
  description: string
  schema: Schema
  annotations?: ToolAnnotations
  /**
   * Whether this tool operates on an active terminal session. When true
   * (default), the runtime calls `context.prepareForCall(sessionId)` before
   * the handler so `context.session()` returns the resolved session and
   * dead-shell auto-respawn is handled. Session-management tools
   * (terminal_create, terminal_list, terminal_destroy)
   * set this to false — they operate on the context, not on a session.
   */
  needsSession?: boolean
  handler: (
    request: {
      params: z.objectOutputType<Schema, z.ZodTypeAny>
      /** Aborts when the MCP client cancels the call. */
      signal?: AbortSignal
    },
    response: McpResponse,
    context: McpContext
  ) => Promise<void>
}

export function defineTool<Schema extends ZodRawShape>(
  def: ToolDefinition<Schema>
): ToolDefinition<Schema> {
  return def
}
