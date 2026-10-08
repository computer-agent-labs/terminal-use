import {z} from 'zod'

import {HARD_CAP_MS} from '../../emulator/settle.js'
import {keyToBytes} from '../../pty/keys.js'
import type {TerminalSession} from '../../session/TerminalSession.js'
import {defineTool} from '../ToolDefinition.js'

import {
  appendBufferState,
  appendShellExited,
  compilePattern,
  renderReadWindow,
  requiredSessionIdField
} from './shared.js'

const MAX_ACTIONS = 50
const MAX_WAIT_MS = 30000
const POLL_MS = 100

const ACTION_TYPES = ['type', 'paste', 'press', 'click', 'scroll', 'wait'] as const

// One flat object rather than a union per action type: every MCP client and
// model copes with a plain object schema, which is not yet true of oneOf.
// Which fields an action needs is checked by hand before anything is sent.
const actionSchema = z.object({
  type: z.enum(ACTION_TYPES).describe('What to do. The fields each type uses are listed in the tool description.'),
  text: z.string().optional().describe('type, paste: the characters. In type, \\n presses Enter.'),
  key: z.string().optional().describe('press: key spec as in terminal_press, e.g. "Enter", "Ctrl+C", "ArrowDown".'),
  count: z.number().int().min(1).max(1000).optional().describe('press: repeat count. Default 1.'),
  col: z.number().int().min(1).max(1000).optional().describe('click (required), scroll (optional): 1-indexed column.'),
  row: z.number().int().min(1).max(1000).optional().describe('click (required), scroll (optional): 1-indexed row.'),
  direction: z.enum(['up', 'down']).optional().describe('scroll: wheel direction.'),
  amount: z.number().int().min(1).max(100).optional().describe('scroll: wheel notches. Default 3.'),
  ms: z.number().int().min(0).max(MAX_WAIT_MS).optional().describe('wait: pause this long.'),
  pattern: z
    .string()
    .min(1)
    .optional()
    .describe('wait: instead of a fixed pause, continue as soon as this regex matches the screen.'),
  timeoutMs: z
    .number()
    .int()
    .min(0)
    .max(MAX_WAIT_MS)
    .optional()
    .describe('wait with pattern: give up (and stop the batch) after this long. Default 5000.')
})

type Action = z.infer<typeof actionSchema>

function describe(a: Action): string {
  switch (a.type) {
    case 'type':
      return `type ${JSON.stringify(a.text)}`
    case 'paste':
      return `paste ${a.text!.length} chars`
    case 'press':
      return a.count && a.count > 1 ? `press ${a.key} x ${a.count}` : `press ${a.key}`
    case 'click':
      return `click (col ${a.col}, row ${a.row})`
    case 'scroll':
      return `scroll ${a.direction} ${a.amount ?? 3}`
    case 'wait':
      return a.pattern !== undefined ? `wait for /${a.pattern}/` : `wait ${a.ms}ms`
  }
}

/** Reject a malformed batch before the first keystroke, so it is all-or-nothing on validity. */
function validate(actions: Action[]): void {
  actions.forEach((a, i) => {
    const fail = (why: string): never => {
      throw new Error(`Action ${i + 1} (${a.type}): ${why}. Nothing was sent.`)
    }
    switch (a.type) {
      case 'type':
      case 'paste':
        if (a.text === undefined) fail('`text` is required')
        break
      case 'press':
        if (a.key === undefined) fail('`key` is required')
        try {
          keyToBytes(a.key!)
        } catch (err) {
          fail(err instanceof Error ? err.message : String(err))
        }
        break
      case 'click':
        if (a.col === undefined || a.row === undefined) fail('`col` and `row` are required')
        break
      case 'scroll':
        if (a.direction === undefined) fail('`direction` is required')
        break
      case 'wait':
        if (a.pattern === undefined && a.ms === undefined) fail('give `ms` or `pattern`')
        if (a.pattern !== undefined) compilePattern(a.pattern)
        break
    }
  })
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

async function waitForPattern(
  session: TerminalSession,
  regex: RegExp,
  timeoutMs: number,
  signal: AbortSignal | undefined
): Promise<boolean> {
  const start = Date.now()
  for (;;) {
    if (!session.isAlive || signal?.aborted) return false
    await session.flush()
    const rows = Math.min(1000, session.term.rows + 200)
    if (regex.test(session.read(rows, 0, {highlights: false}).text.join('\n'))) return true
    if (Date.now() - start >= timeoutMs) return false
    await sleep(POLL_MS)
  }
}

export const batch = defineTool({
  name: 'terminal_batch',
  title: 'Run several terminal inputs',
  description:
    'Send a sequence of inputs in one call and get the screen back once at the end — for driving a ' +
    'full-screen program without a round trip per keystroke (open a menu, move down three, press Enter, ' +
    'type a name, confirm). Actions run in order, each given a moment to take effect before the next.\n\n' +
    'Each action is an object with a `type` and the fields that type uses:\n' +
    '- `type`: `text` — typed as keystrokes; \\n presses Enter.\n' +
    '- `paste`: `text` — delivered as one bracketed paste where the program supports it.\n' +
    '- `press`: `key`, optional `count` — same key specs as terminal_press.\n' +
    '- `click`: `col`, `row` — left click, sent immediately with no preview; needs the program to track the mouse.\n' +
    '- `scroll`: `direction`, optional `amount`, `col`, `row` — as terminal_scroll.\n' +
    '- `wait`: `ms` for a fixed pause, or `pattern` (optional `timeoutMs`) to continue once a regex matches the screen.\n\n' +
    'The batch is validated before anything is sent. It stops at the first action that fails (a pattern ' +
    'that never appears, a click the program cannot receive, the process exiting) and reports how far it ' +
    'got, with the screen as it stands. Use it when you already know the steps; when you need to look ' +
    'between steps, use the individual tools.',
  schema: {
    sessionId: requiredSessionIdField,
    actions: z.array(actionSchema).min(1).max(MAX_ACTIONS).describe(`The inputs to send, in order (1 to ${MAX_ACTIONS}).`),
    stepIdleMs: z
      .number()
      .int()
      .min(0)
      .max(2000)
      .optional()
      .describe(
        'How long output must be quiet after each action before the next is sent. Default 100. Raise it ' +
          'for programs that redraw slowly.'
      ),
    idleMs: z.number().int().min(0).max(HARD_CAP_MS).optional().describe('Settle window after the last action. Default 200.'),
    maxWaitMs: z.number().int().min(0).optional().describe('Cap on the settle after the last action. Default 5000.')
  },
  annotations: {readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true},
  handler: async (request, response, context) => {
    const session = context.session()
    const actions = request.params.actions
    validate(actions)

    const stepSettle = {idleMs: request.params.stepIdleMs ?? 100, maxWaitMs: 2000}
    const lastSettle = {idleMs: request.params.idleMs ?? 200, maxWaitMs: request.params.maxWaitMs ?? 5000}

    let done = 0
    let failure: string | undefined
    for (const [i, a] of actions.entries()) {
      if (request.signal?.aborted) {
        failure = 'the call was cancelled'
        break
      }
      if (!session.isAlive) break
      const settle = i === actions.length - 1 ? lastSettle : stepSettle
      try {
        switch (a.type) {
          case 'type':
            await session.writeText(a.text!, settle)
            break
          case 'paste':
            await session.paste(a.text!, settle)
            break
          case 'press':
            await session.pressKey(a.key!, a.count ?? 1, settle)
            break
          case 'click':
            if (a.col! > session.term.cols || a.row! > session.term.rows) {
              throw new Error(`(col ${a.col}, row ${a.row}) is outside the ${session.term.cols}x${session.term.rows} viewport`)
            }
            if (!session.isMouseModeEnabled()) {
              throw new Error('the foreground program has not enabled mouse tracking, so it cannot receive a click')
            }
            await session.sendLeftClick(a.col!, a.row!, settle)
            break
          case 'scroll':
            await session.scroll(
              a.direction!,
              a.amount ?? 3,
              a.col ?? Math.ceil(session.term.cols / 2),
              a.row ?? Math.ceil(session.term.rows / 2),
              settle
            )
            break
          case 'wait':
            if (a.pattern !== undefined) {
              const matched = await waitForPattern(session, compilePattern(a.pattern), a.timeoutMs ?? 5000, request.signal)
              if (!matched && session.isAlive) {
                throw new Error(`/${a.pattern}/ did not appear within ${a.timeoutMs ?? 5000}ms`)
              }
            } else {
              await sleep(a.ms!)
              await session.flush()
            }
            break
        }
      } catch (err) {
        failure = err instanceof Error ? err.message : String(err)
        break
      }
      if (!session.isAlive) {
        done++
        break
      }
      done++
    }

    if (done === actions.length && !failure && session.isAlive) {
      response.appendLine(`Ran all ${actions.length} action${actions.length === 1 ? '' : 's'}.`)
    } else {
      const next = actions[done]
      if (failure) {
        response.setError(
          `Stopped at action ${done + 1} of ${actions.length} (${next ? describe(next) : '?'}): ${failure}. ` +
            `${done} action${done === 1 ? '' : 's'} before it ${done === 1 ? 'was' : 'were'} sent; the rest were not.`
        )
      } else if (done === actions.length) {
        // Exiting on the last action is the batch succeeding (":wq", "q"),
        // not being cut short.
        response.appendLine(
          `Ran all ${actions.length} action${actions.length === 1 ? '' : 's'}; the process exited after the last one.`
        )
      } else {
        response.appendLine(
          `Stopped after action ${done} of ${actions.length} (${describe(actions[done - 1] ?? actions[0]!)}): ` +
            'the process exited. The remaining actions were not sent.'
        )
      }
    }
    if (!session.isAlive) {
      response.appendBlank()
      appendShellExited(response, session)
      return
    }
    response.appendBlank()
    appendBufferState(response, session.state())
    response.appendBlank()
    renderReadWindow(response, session.read(session.term.rows, 0))
  }
})
