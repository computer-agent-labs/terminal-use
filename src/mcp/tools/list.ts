import {defineTool} from '../ToolDefinition.js'

import {describeSessionLine, describeTombstoneLine} from './shared.js'

export const list = defineTool({
  name: 'terminal_list',
  description:
    'List every active session and every tombstoned (recently-killed but reserved) sessionId. ' +
    'Tombstones are reservations: the shell is gone but the sessionId can still be called against — ' +
    'doing so respawns a fresh shell under the same id and surfaces the original termination reason ' +
    '(shell-exit, idle-killed, or evicted). Tombstones expire after 30 days; after that the id is gone.',
  schema: {},
  annotations: {readOnlyHint: true},
  needsSession: false,
  handler: async (_request, response, context) => {
    const sessions = context.listSessions()
    const tombstones = context.listTombstones()
    if (sessions.length === 0 && tombstones.length === 0) {
      response.appendLine('No sessions. Call terminal_create to spawn one.')
      return
    }
    if (sessions.length > 0) {
      response.appendLine(`${sessions.length} live session(s):`)
      for (const desc of sessions) {
        response.appendLine(describeSessionLine(desc))
      }
    } else {
      response.appendLine('0 live sessions.')
    }
    if (tombstones.length > 0) {
      response.appendBlank()
      response.appendLine(`${tombstones.length} tombstoned id(s) (call against them to respawn):`)
      for (const t of tombstones) {
        response.appendLine(describeTombstoneLine(t))
      }
    }
  }
})
