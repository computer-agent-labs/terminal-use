import {z} from 'zod'

import {defineTool} from '../ToolDefinition.js'

import {describeSessionLine} from './shared.js'

export const create = defineTool({
  name: 'terminal_create',
  description:
    'Spawn a new terminal session and return its sessionId. Use this at the start of a task ' +
    'when you want a clean, independent shell rather than continuing whatever session is current. ' +
    'If no session existed before, the new one becomes the current default automatically. ' +
    'Other tools can target this session by passing `sessionId`, or you can call `terminal_select` ' +
    'to make it the new default.',
  schema: {
    label: z
      .string()
      .min(1)
      .max(64)
      .optional()
      .describe('Optional human-readable name shown by terminal_list (e.g. "dev-server", "tests").'),
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
    response.appendLine(`Created session ${desc.sessionId}${desc.label ? ` "${desc.label}"` : ''}.`)
    response.appendBlank()
    response.appendLine(describeSessionLine(desc))
  }
})
