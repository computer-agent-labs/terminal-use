import type {z, ZodRawShape} from 'zod'

import type {McpContext} from './McpContext.js'
import type {McpResponse} from './McpResponse.js'

/** MCP behavior hints. Clients use them to decide what needs confirmation. */
export interface ToolAnnotations {
  /** The tool changes nothing. */
  readOnlyHint?: boolean
  /** The tool may destroy or overwrite something (only meaningful when not read-only). */
  destructiveHint?: boolean
  /** Repeating the call with the same arguments has no further effect. */
  idempotentHint?: boolean
  /** The tool can reach beyond this machine (a shell can: network, ssh…). */
  openWorldHint?: boolean
}

export interface ToolDefinition<Schema extends ZodRawShape = ZodRawShape> {
  name: string
  /** Human-readable name for client UIs. */
  title: string
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
  /**
   * Whether the tool still makes sense once a command session's process has
   * exited (reading its final screen, restarting it). Tools that send input
   * leave this unset and are refused with the exit status instead.
   */
  worksAfterExit?: boolean
  handler: (
    request: {
      params: z.infer<z.ZodObject<Schema>>
      /** Aborts when the MCP client cancels the call. */
      signal?: AbortSignal
      /** Report progress on a long call; present only if the client asked for it. */
      progress?: (message: string) => void
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
