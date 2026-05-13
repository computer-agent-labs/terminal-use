import xtermHeadless from '@xterm/headless';
// `@xterm/headless` ships as a UMD bundle, so Node's ESM resolver doesn't
// expose `Terminal` as a named export — we have to pull it off the default.
const { Terminal: TerminalClass } = xtermHeadless;
export function createTerminal(options) {
    return new TerminalClass({
        cols: options.cols,
        rows: options.rows,
        scrollback: options.scrollback ?? 5000,
        allowProposedApi: true
    });
}
export function writeAndFlush(term, data) {
    return new Promise(resolve => term.write(data, () => resolve()));
}
export function bufferState(term) {
    const buf = term.buffer.active;
    const baseY = buf.baseY;
    return {
        bufferLength: buf.length,
        cols: term.cols,
        rows: term.rows,
        cursorRow: baseY + buf.cursorY,
        cursorCol: buf.cursorX,
        viewportStart: baseY,
        viewportEnd: baseY + term.rows - 1,
        isAlt: buf.type === 'alternate'
    };
}
//# sourceMappingURL=terminal.js.map