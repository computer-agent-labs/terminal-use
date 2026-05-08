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
  handler: (
    request: {params: z.objectOutputType<Schema, z.ZodTypeAny>},
    response: McpResponse,
    context: McpContext
  ) => Promise<void>
}

export function defineTool<Schema extends ZodRawShape>(
  def: ToolDefinition<Schema>
): ToolDefinition<Schema> {
  return def
}
