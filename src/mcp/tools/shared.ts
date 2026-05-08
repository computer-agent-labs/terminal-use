import type {SettleResult} from '../../emulator/settle.js'
import type {BufferState} from '../../emulator/terminal.js'
import type {ReadWindow} from '../../session/TerminalSession.js'
import type {McpResponse} from '../McpResponse.js'

export function appendSettleNote(
  response: McpResponse,
  result: SettleResult,
  requestedMaxWaitMs: number
): void {
  if (result.outcome === 'deferred') {
    response.appendLine(
      `Did not wait (you set maxWaitMs=${requestedMaxWaitMs}, which is longer than the 10s cap). ` +
        'Call `terminal_read` later to see the output.'
    )
    return
  }
  if (result.outcome === 'timeout') {
    response.appendLine(
      `Buffer was still active after ${result.elapsedMs}ms (${result.bytesObserved} bytes received). ` +
        'Call `terminal_read` later to see further output.'
    )
    return
  }
  response.appendLine(
    `Settled in ${result.elapsedMs}ms (${result.bytesObserved} bytes received).`
  )
}

export function appendBufferState(response: McpResponse, state: BufferState): void {
  const altNote = state.isAlt ? ' (alt buffer active)' : ''
  response.appendLine(
    `Terminal: ${state.cols}x${state.rows}${altNote}, cursor at row=${state.cursorRow} col=${state.cursorCol}, ` +
      `buffer length ${state.bufferLength}, viewport rows ${state.viewportStart}..${state.viewportEnd}.`
  )
}

export const CURSOR_MARKER = '▌'

export function markCursor(line: string, col: number, marker = CURSOR_MARKER): string {
  if (col <= line.length) {
    if (col === line.length) return line + marker
    return line.slice(0, col) + marker + line.slice(col + 1)
  }
  return line + ' '.repeat(col - line.length) + marker
}

export function renderReadWindow(
  response: McpResponse,
  win: ReadWindow,
  options: {showCursor?: boolean} = {}
): void {
  const showCursor = options.showCursor ?? true
  const lines = [...win.text]
  if (showCursor) {
    const cursorRowInWindow = win.state.cursorRow - win.window.start
    if (cursorRowInWindow >= 0 && cursorRowInWindow < lines.length) {
      lines[cursorRowInWindow] = markCursor(lines[cursorRowInWindow]!, win.state.cursorCol)
    } else if (cursorRowInWindow === lines.length && win.state.cursorRow <= win.window.end) {
      // cursor row exists in the window but trailing-blank trimming dropped it
      lines.push(markCursor('', win.state.cursorCol))
    }
  }
  if (lines.length === 0) {
    response.appendLine('(empty buffer)')
    return
  }
  response.appendLine(
    `Showing rows ${win.window.start}..${win.window.end} (page ${win.window.page + 1} of ${win.window.totalPages}, ` +
      `${win.window.rows} rows per page${showCursor ? `; cursor marked with "${CURSOR_MARKER}"` : ''}):`
  )
  response.appendLine('---')
  for (const line of lines) {
    response.appendLine(line)
  }
  response.appendLine('---')
}
