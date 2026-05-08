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

export function renderReadWindow(response: McpResponse, win: ReadWindow): void {
  if (win.text.length === 0) {
    response.appendLine('(empty buffer)')
    return
  }
  response.appendLine(
    `Showing rows ${win.window.start}..${win.window.end} (page ${win.window.page + 1} of ${win.window.totalPages}, ` +
      `${win.window.rows} rows per page):`
  )
  response.appendLine('---')
  for (const line of win.text) {
    response.appendLine(line)
  }
  response.appendLine('---')
}
