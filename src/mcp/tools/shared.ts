import {z} from 'zod'

import type {SettleResult} from '../../emulator/settle.js'
import type {BufferState} from '../../emulator/terminal.js'
import type {CursorInText, ReadWindow, TerminalSession} from '../../session/TerminalSession.js'
import type {SessionDescriptor, TombstoneDescriptor} from '../McpContext.js'
import type {McpResponse} from '../McpResponse.js'

export const requiredSessionIdField = z
  .number()
  .int()
  .min(1)
  .describe(
    'Numeric id of the session to target. Get one by calling terminal_create. ' +
      'Use terminal_list to enumerate currently-known ids.'
  )

export function describeSessionLine(d: SessionDescriptor): string {
  const tag = d.label ? `${d.sessionId} ("${d.label}")` : `${d.sessionId}`
  const idleSecs = Math.round((Date.now() - d.lastActivityAt.getTime()) / 1000)
  return `[${tag}] ${d.cols}x${d.rows} pid=${d.pid} shell=${d.shell || '?'} cwd=${d.cwd || '?'} theme=${d.theme} idle=${idleSecs}s`
}

export function describeTombstoneLine(t: TombstoneDescriptor): string {
  const tag = t.label ? `${t.sessionId} ("${t.label}")` : `${t.sessionId}`
  const exit =
    t.reason === 'shell-exit' && t.exitCode !== undefined
      ? ` (exit code ${t.exitCode}${t.exitSignal !== undefined ? `, signal ${t.exitSignal}` : ''})`
      : ''
  return `[${tag}] tombstoned: ${t.reason}${exit} at ${t.at.toISOString()}, expires ${t.expiresAt.toISOString()}`
}

export function appendSettleNote(response: McpResponse, result: SettleResult): void {
  if (result.outcome === 'timeout') {
    response.appendLine(
      `Buffer was still active after ${result.elapsedMs}ms (${result.bytesObserved} bytes received)` +
        (result.capped ? ' — maxWaitMs is capped at 10s here' : '') +
        '. Call `terminal_wait` to wait for the command to finish, or `terminal_read` to check on it.'
    )
    return
  }
  response.appendLine(
    `Settled in ${result.elapsedMs}ms (${result.bytesObserved} bytes received).`
  )
}

/** Shared tail for calls during which the shell went away. */
export function appendShellExited(response: McpResponse, session: TerminalSession): void {
  const exit = session.exited
  response.appendLine(
    `The shell exited during this call${exit ? ` (exit code ${exit.exitCode})` : ''}. The next tool call ` +
      'against this sessionId will auto-respawn — re-issue your command if relevant.'
  )
  const screen = session.finalScreen
  if (screen?.length) {
    response.appendBlank()
    response.appendLine('Last screen before the shell exited:')
    response.appendLine('---')
    for (const line of screen) response.appendLine(line)
    response.appendLine('---')
  }
}

export function appendBufferState(response: McpResponse, state: BufferState): void {
  const altNote = state.isAlt ? ' (alt buffer active)' : ''
  const hiddenNote = state.cursorHidden ? ' (hidden)' : ''
  response.appendLine(
    `Terminal: ${state.cols}x${state.rows}${altNote}, cursor at row=${state.cursorRow} col=${state.cursorCol}${hiddenNote}, ` +
      `buffer length ${state.bufferLength}, viewport rows ${state.viewportStart}..${state.viewportEnd}.`
  )
}

export const CURSOR_MARKER = '▌'

/**
 * Mark the cursor in `line`. Nothing is ever overwritten:
 *  - on an empty cell, the marker takes the place of the blank;
 *  - on a character, the marker is inserted in front of it. That pushes the
 *    rest of that one line a column to the right — visibility of the cursor
 *    is worth more to a reader of plain text than alignment on its row.
 */
export function markCursor(line: string, cursor: CursorInText): string {
  const {index, length} = cursor
  if (index >= line.length) return line + ' '.repeat(index - line.length) + CURSOR_MARKER
  if (length > 0) return line.slice(0, index) + CURSOR_MARKER + line.slice(index)
  return line.slice(0, index) + CURSOR_MARKER + line.slice(index + 1)
}

/** Says which character the marker sits in front of, so there is no doubt. */
function describeCursor(win: ReadWindow): string {
  const line = win.text[win.state.cursorRow - win.window.start] ?? ''
  const {index, length} = win.cursor
  if (length === 0 || index >= line.length) return `cursor marked with "${CURSOR_MARKER}"`
  return (
    `cursor marked with "${CURSOR_MARKER}", inserted in front of the ` +
    `${JSON.stringify(line.slice(index, index + length))} it is on`
  )
}

export function renderReadWindow(
  response: McpResponse,
  win: ReadWindow,
  options: {showCursor?: boolean} = {}
): void {
  // A program that hid the cursor (most full-screen TUIs) isn't showing one
  // to a human either, so don't draw a marker into its layout.
  const showCursor = (options.showCursor ?? true) && !win.state.cursorHidden
  const lines = [...win.text]
  if (showCursor) {
    const cursorRowInWindow = win.state.cursorRow - win.window.start
    if (cursorRowInWindow >= 0 && cursorRowInWindow < lines.length) {
      lines[cursorRowInWindow] = markCursor(lines[cursorRowInWindow]!, win.cursor)
    } else if (cursorRowInWindow >= lines.length && win.state.cursorRow <= win.window.end) {
      // cursor row exists in the window but trailing-blank trimming dropped it
      while (lines.length < cursorRowInWindow) lines.push('')
      lines.push(markCursor('', win.cursor))
    }
  }
  if (lines.length === 0) {
    response.appendLine('(empty buffer)')
    return
  }
  response.appendLine(
    `Showing rows ${win.window.start}..${win.window.end} (page ${win.window.page + 1} of ${win.window.totalPages}, ` +
      `${win.window.rows} rows per page${showCursor ? `; ${describeCursor(win)}` : ''}):`
  )
  response.appendLine('---')
  for (const line of lines) {
    response.appendLine(line)
  }
  response.appendLine('---')
}
