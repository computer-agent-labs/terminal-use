import {z} from 'zod'

import {defineTool} from '../ToolDefinition.js'

import {appendBufferState, appendShellExited, renderReadWindow, requiredSessionIdField} from './shared.js'

export const WAIT_MAX_MS = 10 * 60 * 1000
const POLL_MS = 150
/** Rows of scrollback above the viewport that `pattern` is matched against. */
const PATTERN_SCROLLBACK_ROWS = 200
/** Quiet period used in place of the foreground check when it isn't available. */
const FALLBACK_QUIET_MS = 2000

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

export const wait = defineTool({
  name: 'terminal_wait',
  title: 'Wait for terminal',
  description:
    'Block until the terminal reaches a state, instead of guessing with sleeps or polling `terminal_read`. ' +
    'Use it after `terminal_type` for anything that outlives the settle window: builds, installs, test runs, ' +
    'servers starting up.\n\n' +
    'DEFAULT (no `pattern`): waits for the running command to finish — i.e. for the shell to take the ' +
    "terminal's foreground back and its prompt to go quiet. This asks the kernel who owns the terminal, so " +
    'it works with any prompt and stays correct while a command is silent (`sleep 60`) or chatty. Returns ' +
    'immediately if the shell is already at its prompt. In a session created with `command`, it waits for ' +
    'that command to exit and reports its exit status. Background jobs (`cmd &`) do not count as running, ' +
    'and inside a nested program (ssh, a REPL, a TUI) the outer shell never regains the foreground until ' +
    'that program exits — use `pattern` there.\n\n' +
    '`until: "quiet"`: waits until nothing has been printed for `quietMs` (default 1000), whatever owns the ' +
    'terminal. This is the same "settled" rule `terminal_type` uses, without its 10s cap — for nested ' +
    'programs where completion cannot be detected and no pattern fits.\n\n' +
    'WITH `pattern`: waits until the regex matches the text on screen (the viewport plus the ' +
    `${PATTERN_SCROLLBACK_ROWS} rows above it). Use this for servers that never exit ("Listening on"), ` +
    'REPL prompts, or TUI states. Text that is already on screen counts, so pick a pattern that only the ' +
    'new output can satisfy.\n\n' +
    'Returns the screen when the condition is met, or when `timeoutMs` runs out (not an error — the ' +
    'response says the command is still running). Does not report an exit status; run `echo $?` afterwards ' +
    'if you need it.',
  schema: {
    sessionId: requiredSessionIdField,
    pattern: z
      .string()
      .min(1)
      .optional()
      .describe(
        'JavaScript regular expression matched against the screen text, lines joined with "\\n" ' +
          '(e.g. "Listening on .*:3000", "\\\\$ $", "(?i)error"). Omit to wait for command completion.'
      ),
    until: z
      .enum(['command', 'quiet'])
      .optional()
      .describe(
        '"command" (default): the running command has finished and the shell is back at its prompt. ' +
          '"quiet": output has been silent for `quietMs`. Ignored when `pattern` is given.'
      ),
    timeoutMs: z
      .number()
      .int()
      .min(0)
      .max(WAIT_MAX_MS)
      .optional()
      .describe(`Give up after this long. Default 30000, max ${WAIT_MAX_MS}.`),
    quietMs: z
      .number()
      .int()
      .min(0)
      .max(10000)
      .optional()
      .describe(
        'How long the output must stay silent. With until="command" (default 300) it applies once the ' +
          'shell is back in the foreground, so the prompt has finished drawing; with until="quiet" ' +
          '(default 1000) it is the whole condition.'
      )
  },
  annotations: {readOnlyHint: true, openWorldHint: false},
  worksAfterExit: true,
  handler: async (request, response, context) => {
    const session = context.session()
    const timeoutMs = request.params.timeoutMs ?? 30000
    const until = request.params.until ?? 'command'
    const quietMs = request.params.quietMs ?? (until === 'quiet' ? 1000 : 300)

    let regex: RegExp | undefined
    if (request.params.pattern !== undefined) {
      // Accept the common inline "(?i)" prefix; JS has no inline flags.
      const m = /^\(\?([imsu]+)\)/.exec(request.params.pattern)
      try {
        regex = new RegExp(m ? request.params.pattern.slice(m[0].length) : request.params.pattern, m?.[1] ?? '')
      } catch (err) {
        throw new Error(`Invalid pattern: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    const start = Date.now()
    let lastOutputAt = start
    let fellBack = false
    const unsubscribe = session.onData(() => {
      lastOutputAt = Date.now()
    })

    let outcome: 'done' | 'timeout' | 'exited' | 'cancelled'
    try {
      for (;;) {
        if (request.signal?.aborted) {
          outcome = 'cancelled'
          break
        }
        if (!session.isAlive) {
          outcome = 'exited'
          break
        }
        await session.flush()
        if (!session.isAlive) {
          outcome = 'exited'
          break
        }
        if (regex) {
          const rows = Math.min(1000, session.term.rows + PATTERN_SCROLLBACK_ROWS)
          if (regex.test(session.read(rows, 0, {highlights: false}).text.join('\n'))) {
            outcome = 'done'
            break
          }
        } else if (until === 'quiet') {
          if (Date.now() - lastOutputAt >= quietMs) {
            outcome = 'done'
            break
          }
        } else if (session.isCommand) {
          // The session's process *is* the command: it is done when it
          // exits, which the isAlive checks above catch.
        } else {
          const foreground = await session.foreground()
          const quietFor = Date.now() - lastOutputAt
          if (foreground === 'shell' && quietFor >= quietMs) {
            outcome = 'done'
            break
          }
          // No way to ask who owns the terminal (Windows, no `ps`): the
          // best signal left is a longer stretch of silence.
          if (foreground === 'unknown' && quietFor >= Math.max(quietMs, FALLBACK_QUIET_MS)) {
            fellBack = true
            outcome = 'done'
            break
          }
        }
        request.progress?.(
          regex
            ? `Waiting for ${regex} (${Math.round((Date.now() - start) / 1000)}s)`
            : `Waiting for ${until === 'quiet' ? 'output to go quiet' : 'the command to finish'} ` +
              `(${Math.round((Date.now() - start) / 1000)}s)`
        )
        const remaining = timeoutMs - (Date.now() - start)
        if (remaining <= 0) {
          outcome = 'timeout'
          break
        }
        await sleep(Math.min(POLL_MS, remaining))
      }
    } finally {
      unsubscribe()
    }

    const elapsed = Date.now() - start
    if (outcome === 'exited') {
      appendShellExited(response, session)
      return
    }
    if (outcome === 'cancelled') {
      response.appendLine(`Wait cancelled after ${elapsed}ms.`)
      return
    }
    if (outcome === 'done') {
      response.appendLine(
        regex
          ? `Pattern ${regex} matched after ${elapsed}ms.`
          : until === 'quiet'
            ? `Output has been quiet for ${quietMs}ms, ${elapsed}ms after the call started.`
            : fellBack
              ? `Output has been quiet for a while after ${elapsed}ms. Could not check which process owns the ` +
              'terminal on this system, so this is a guess — confirm from the screen below.'
              : `Command finished: the shell is back at its prompt after ${elapsed}ms.`
      )
    } else {
      response.appendLine(
        regex
          ? `Timed out after ${elapsed}ms: pattern ${regex} has not appeared.`
          : until === 'quiet'
            ? `Timed out after ${elapsed}ms: output never stayed quiet for ${quietMs}ms.`
            : `Timed out after ${elapsed}ms: the command is still running. Call terminal_wait again to keep ` +
            'waiting, or terminal_press Ctrl+C to interrupt it.'
      )
    }
    response.appendBlank()
    appendBufferState(response, session.state())
    response.appendBlank()
    renderReadWindow(response, session.read(session.term.rows, 0))
  }
})
