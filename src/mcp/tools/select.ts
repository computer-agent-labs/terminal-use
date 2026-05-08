import {z} from 'zod'

import {defineTool} from '../ToolDefinition.js'

import {describeSessionLine} from './shared.js'

export const select = defineTool({
  name: 'terminal_select',
  description:
    'Set which session is the current default. Tools that omit `sessionId` will then target this one. ' +
    'You can always still target a specific session by passing `sessionId` per call without changing the default.',
  schema: {
    sessionId: z.number().int().min(1).describe('Numeric id from terminal_create or terminal_list.')
  },
  annotations: {readOnlyHint: false},
  needsSession: false,
  handler: async (request, response, context) => {
    const desc = context.selectSession(request.params.sessionId)
    response.appendLine(`Default is now session ${desc.sessionId}${desc.label ? ` "${desc.label}"` : ''}.`)
    response.appendBlank()
    response.appendLine(describeSessionLine(desc))
  }
})
