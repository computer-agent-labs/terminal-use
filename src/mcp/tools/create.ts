import {z} from 'zod'

import {defineTool} from '../ToolDefinition.js'

import {describeSessionLine} from './shared.js'

export const create = defineTool({
  name: 'terminal_create',
  description:
    'Spawn a new terminal session and return its sessionId. You must call this before any per-session ' +
    'tool — there is no shared default session. ' +
    'If the server already holds 50 live sessions, the least-recently-used one is evicted to make room ' +
    "(its sessionId is tombstoned and any later call against it will respawn with an 'evicted' notice).",
  schema: {
    label: z
      .string()
      .min(1)
      .max(64)
      .optional()
      .describe('Optional human-readable name shown in terminal_list output (e.g. "dev-server").'),
    cols: z.number().int().min(1).max(1000).optional(),
    rows: z.number().int().min(1).max(1000).optional(),
    shell: z.string().optional().describe('Override the default shell (e.g. "/bin/zsh").'),
    cwd: z.string().optional().describe('Override the default working directory.'),
    scrollback: z.number().int().min(100).max(50000).optional()
  },
  annotations: {readOnlyHint: false},
  needsSession: false,
  handler: async (request, response, context) => {
    const desc = context.createSession({
      label: request.params.label,
      cols: request.params.cols,
      rows: request.params.rows,
      shell: request.params.shell,
      cwd: request.params.cwd,
      scrollback: request.params.scrollback
    })
    response.appendLine(`Created session ${desc.sessionId}${desc.label ? ` ("${desc.label}")` : ''}.`)
    response.appendLine(describeSessionLine(desc))
  }
})
