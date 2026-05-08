import {defineTool} from '../ToolDefinition.js'

import {describeSessionLine} from './shared.js'

export const list = defineTool({
  name: 'terminal_list',
  description:
    'List every active terminal session. The currently-selected default session is marked with "*". ' +
    'Sessions whose shell has died are shown with their exit info; the next tool call against such a ' +
    'session will auto-respawn it.',
  schema: {},
  annotations: {readOnlyHint: true},
  needsSession: false,
  handler: async (_request, response, context) => {
    const sessions = context.listSessions()
    if (sessions.length === 0) {
      response.appendLine('No sessions. Use terminal_create or any tool to spawn one.')
      return
    }
    response.appendLine(`${sessions.length} session(s):`)
    for (const desc of sessions) {
      response.appendLine(describeSessionLine(desc))
    }
  }
})
