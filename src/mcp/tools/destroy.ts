import {z} from 'zod'

import {defineTool} from '../ToolDefinition.js'

export const destroy = defineTool({
  name: 'terminal_destroy',
  description:
    'Kill a session and remove it from the list. The shell process is terminated. ' +
    'If the destroyed session was the current default, another remaining session (if any) becomes the default.',
  schema: {
    sessionId: z.number().int().min(1).describe('Numeric id from terminal_create or terminal_list.')
  },
  annotations: {readOnlyHint: false},
  needsSession: false,
  handler: async (request, response, context) => {
    const desc = context.destroySession(request.params.sessionId)
    response.appendLine(
      `Destroyed session ${desc.sessionId}${desc.label ? ` "${desc.label}"` : ''} (was pid ${desc.pid}).`
    )
    const remaining = context.listSessions()
    if (remaining.length === 0) {
      response.appendLine('No sessions remain. Next tool call will auto-create a fresh default.')
    } else {
      response.appendLine(
        `${remaining.length} session(s) remaining; current default: ${context.currentId ?? '(none)'}.`
      )
    }
  }
})
