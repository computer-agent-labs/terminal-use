import { z } from 'zod';
export const requiredSessionIdField = z
    .number()
    .int()
    .min(1)
    .describe('Numeric id of the session to target. Get one by calling terminal_create. ' +
    'Use terminal_list to enumerate currently-known ids.');
export function describeSessionLine(d) {
    const tag = d.label ? `${d.sessionId} ("${d.label}")` : `${d.sessionId}`;
    const idleSecs = Math.round((Date.now() - d.lastActivityAt.getTime()) / 1000);
    return `[${tag}] ${d.cols}x${d.rows} pid=${d.pid} shell=${d.shell || '?'} cwd=${d.cwd || '?'} theme=${d.theme} idle=${idleSecs}s`;
}
export function describeTombstoneLine(t) {
    const tag = t.label ? `${t.sessionId} ("${t.label}")` : `${t.sessionId}`;
    const exit = t.reason === 'shell-exit' && t.exitCode !== undefined
        ? ` (exit code ${t.exitCode}${t.exitSignal !== undefined ? `, signal ${t.exitSignal}` : ''})`
        : '';
    return `[${tag}] tombstoned: ${t.reason}${exit} at ${t.at.toISOString()}, expires ${t.expiresAt.toISOString()}`;
}
export function appendSettleNote(response, result, requestedMaxWaitMs) {
    if (result.outcome === 'deferred') {
        response.appendLine(`Did not wait (you set maxWaitMs=${requestedMaxWaitMs}, which is longer than the 10s cap). ` +
            'Call `terminal_read` later to see the output.');
        return;
    }
    if (result.outcome === 'timeout') {
        response.appendLine(`Buffer was still active after ${result.elapsedMs}ms (${result.bytesObserved} bytes received). ` +
            'Call `terminal_read` later to see further output.');
        return;
    }
    response.appendLine(`Settled in ${result.elapsedMs}ms (${result.bytesObserved} bytes received).`);
}
export function appendBufferState(response, state) {
    const altNote = state.isAlt ? ' (alt buffer active)' : '';
    response.appendLine(`Terminal: ${state.cols}x${state.rows}${altNote}, cursor at row=${state.cursorRow} col=${state.cursorCol}, ` +
        `buffer length ${state.bufferLength}, viewport rows ${state.viewportStart}..${state.viewportEnd}.`);
}
export const CURSOR_MARKER = '▌';
export function markCursor(line, col, marker = CURSOR_MARKER) {
    if (col <= line.length) {
        if (col === line.length)
            return line + marker;
        return line.slice(0, col) + marker + line.slice(col + 1);
    }
    return line + ' '.repeat(col - line.length) + marker;
}
export function renderReadWindow(response, win, options = {}) {
    const showCursor = options.showCursor ?? true;
    const lines = [...win.text];
    if (showCursor) {
        const cursorRowInWindow = win.state.cursorRow - win.window.start;
        if (cursorRowInWindow >= 0 && cursorRowInWindow < lines.length) {
            lines[cursorRowInWindow] = markCursor(lines[cursorRowInWindow], win.state.cursorCol);
        }
        else if (cursorRowInWindow === lines.length && win.state.cursorRow <= win.window.end) {
            // cursor row exists in the window but trailing-blank trimming dropped it
            lines.push(markCursor('', win.state.cursorCol));
        }
    }
    if (lines.length === 0) {
        response.appendLine('(empty buffer)');
        return;
    }
    response.appendLine(`Showing rows ${win.window.start}..${win.window.end} (page ${win.window.page + 1} of ${win.window.totalPages}, ` +
        `${win.window.rows} rows per page${showCursor ? `; cursor marked with "${CURSOR_MARKER}"` : ''}):`);
    response.appendLine('---');
    for (const line of lines) {
        response.appendLine(line);
    }
    response.appendLine('---');
}
//# sourceMappingURL=shared.js.map