import {z} from 'zod'

import {defineTool} from '../ToolDefinition.js'

export const destroy = defineTool({
  name: 'terminal_destroy',
  title: 'Destroy terminal session',
  description:
    'Kill a session and forget the sessionId entirely. The shell process is terminated and the ' +
    'sessionId is *not* tombstoned — future calls against it will error with "Unknown sessionId". ' +
    "Use this when you're explicitly done with a session. Tombstones (which auto-respawn on next " +
    'access) only happen for system-driven terminations: idle-kill, eviction, or shell exit.',
  schema: {
    sessionId: z.number().int().min(1).describe('Numeric id from terminal_create or terminal_list.')
  },
  annotations: {readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false},
  needsSession: false,
  handler: async (request, response, context) => {
    const desc = context.destroySession(request.params.sessionId)
    response.appendLine(
      `Destroyed session ${desc.sessionId}${desc.label ? ` ("${desc.label}")` : ''}` +
        (desc.pid > 0 ? ` (was pid ${desc.pid}).` : ' (was already tombstoned).')
    )
  }
})
