import { windowMath } from '../emulator/pagination.js';
import { ptyAsSource, waitSettled } from '../emulator/settle.js';
import { bufferState, createTerminal } from '../emulator/terminal.js';
import { keyToBytes } from '../pty/keys.js';
import { leftClickSequence } from '../pty/mouse.js';
import { defaultShell, spawnPty } from '../pty/spawn.js';
export class TerminalSession {
    #pty;
    #term;
    #config;
    #pendingFlushes = [];
    #disposed = false;
    #exited;
    #exitListeners = [];
    #dataListeners = [];
    constructor(config) {
        this.#config = {
            shell: config.shell ?? defaultShell(),
            cwd: config.cwd ?? process.cwd(),
            cols: config.cols,
            rows: config.rows,
            scrollback: config.scrollback ?? 5000
        };
        this.#spawn();
    }
    #spawn() {
        this.#exited = undefined;
        this.#term = createTerminal({
            cols: this.#config.cols,
            rows: this.#config.rows,
            scrollback: this.#config.scrollback
        });
        this.#pty = spawnPty({
            shell: this.#config.shell,
            cwd: this.#config.cwd,
            cols: this.#config.cols,
            rows: this.#config.rows
        });
        const myPty = this.#pty;
        this.#pty.onData(chunk => {
            if (this.#pty !== myPty)
                return;
            const flush = new Promise(resolve => this.#term.write(chunk, () => resolve()));
            this.#pendingFlushes.push(flush);
            // Fan out the raw PTY bytes to any extra subscribers (e.g. an
            // AttachServer broadcasting to attached human clients). Same
            // bytes that hit the emulator — order-of-arrival preserved.
            if (this.#dataListeners.length > 0) {
                for (const cb of [...this.#dataListeners]) {
                    try {
                        cb(chunk);
                    }
                    catch {
                        // listener errors must not break the pty event loop
                    }
                }
            }
        });
        this.#term.onData(chunk => {
            if (this.#pty !== myPty)
                return;
            this.#pty.write(chunk);
        });
        this.#pty.onExit(({ exitCode, signal }) => {
            // Ignore exit events from a pty that was already replaced (e.g. via
            // hardReset) — only the currently-active pty's exit should be tracked.
            if (this.#pty !== myPty)
                return;
            const info = { exitCode, signal, at: new Date() };
            this.#exited = info;
            if (!this.#disposed) {
                for (const cb of [...this.#exitListeners]) {
                    try {
                        cb(info);
                    }
                    catch {
                        // listener errors must not break the pty event loop
                    }
                }
            }
        });
    }
    onExit(cb) {
        this.#exitListeners.push(cb);
        return () => {
            const i = this.#exitListeners.indexOf(cb);
            if (i >= 0)
                this.#exitListeners.splice(i, 1);
        };
    }
    onData(cb) {
        this.#dataListeners.push(cb);
        return () => {
            const i = this.#dataListeners.indexOf(cb);
            if (i >= 0)
                this.#dataListeners.splice(i, 1);
        };
    }
    get pty() {
        this.#assertAlive();
        return this.#pty;
    }
    get term() {
        this.#assertAlive();
        return this.#term;
    }
    get config() {
        return this.#config;
    }
    get exited() {
        return this.#exited;
    }
    get isAlive() {
        return !this.#disposed && !this.#exited;
    }
    #assertAlive() {
        if (this.#disposed)
            throw new Error('TerminalSession has been disposed');
    }
    /**
     * Wait for the freshly-spawned shell to print its prompt and settle. Used
     * after auto-respawn so the next tool call doesn't race the prompt redraw.
     */
    async waitForReady() {
        this.#assertAlive();
        await waitSettled(ptyAsSource(this.#pty), { idleMs: 200, maxWaitMs: 3000 });
        await this.flush();
    }
    async flush() {
        while (this.#pendingFlushes.length > 0) {
            if (this.#disposed) {
                // Term was disposed (e.g. via shell-exit handler). Its write
                // callbacks may never fire — drop pending and return rather than
                // hanging the caller.
                this.#pendingFlushes = [];
                return;
            }
            const pending = this.#pendingFlushes;
            this.#pendingFlushes = [];
            // Defensive race: even if we were alive entering this iteration, the
            // session can be disposed during the await. If that happens and the
            // write callbacks never fire, a 500ms cap prevents an indefinite hang.
            await Promise.race([
                Promise.all(pending).then(() => undefined),
                new Promise(resolve => setTimeout(resolve, 500))
            ]);
        }
    }
    async writeText(text, settle) {
        this.#assertAlive();
        const normalized = text.replace(/\r\n|\n/g, '\r');
        const settler = waitSettled(ptyAsSource(this.#pty), settle);
        this.#pty.write(normalized);
        const result = await settler;
        await this.flush();
        return result;
    }
    async pressKey(spec, count, settle) {
        this.#assertAlive();
        const sequence = keyToBytes(spec);
        const payload = count <= 1 ? sequence : sequence.repeat(count);
        const settler = waitSettled(ptyAsSource(this.#pty), settle);
        this.#pty.write(payload);
        const result = await settler;
        await this.flush();
        return result;
    }
    /**
     * Whether the program currently in the foreground has opted into mouse
     * tracking (any non-'none' mode). Reflects the latest DECSET state seen
     * by the emulator — set when the program prints `\x1b[?1000h` /
     * `\x1b[?1002h` / etc., reset when it prints the matching DECRST.
     */
    isMouseModeEnabled() {
        return this.#term.modes.mouseTrackingMode !== 'none';
    }
    async sendLeftClick(col, row, settle) {
        this.#assertAlive();
        const settler = waitSettled(ptyAsSource(this.#pty), settle);
        this.#pty.write(leftClickSequence(col, row));
        const result = await settler;
        await this.flush();
        return result;
    }
    async resize(cols, rows) {
        this.#assertAlive();
        const newCols = cols ?? this.#term.cols;
        const newRows = rows ?? this.#term.rows;
        if (newCols === this.#term.cols && newRows === this.#term.rows) {
            return { cols: newCols, rows: newRows };
        }
        this.#pty.resize(newCols, newRows);
        this.#term.resize(newCols, newRows);
        this.#config = { ...this.#config, cols: newCols, rows: newRows };
        return { cols: newCols, rows: newRows };
    }
    async softReset() {
        this.#assertAlive();
        this.#term.reset();
        this.#term.clear();
        // Nudge the shell to print a fresh prompt — without this, the cleared
        // screen stays blank until the agent presses something, and they may
        // assume the shell is dead. Submitting an empty line (`\r`) is the most
        // portable trigger: bash/zsh/sh all redraw their prompt for it.
        const settler = waitSettled(ptyAsSource(this.#pty), { idleMs: 200, maxWaitMs: 2000 });
        this.#pty.write('\r');
        await settler;
        await this.flush();
    }
    async hardReset(overrides) {
        this.#assertAlive();
        const oldPty = this.#pty;
        const oldTerm = this.#term;
        this.#config = {
            ...this.#config,
            cols: overrides.cols ?? this.#config.cols,
            rows: overrides.rows ?? this.#config.rows,
            shell: overrides.shell ?? this.#config.shell,
            cwd: overrides.cwd ?? this.#config.cwd
        };
        this.#pendingFlushes = [];
        this.#spawn();
        try {
            oldPty.kill();
        }
        catch {
            // pty may already be dead
        }
        oldTerm.dispose();
    }
    read(rows, page) {
        this.#assertAlive();
        const buf = this.#term.buffer.active;
        const win = windowMath(buf.length, page, rows);
        const text = [];
        if (buf.length === 0 || win.end < win.start) {
            return { text, window: win, state: bufferState(this.#term) };
        }
        for (let y = win.start; y <= win.end; y++) {
            const line = buf.getLine(y);
            text.push(line ? line.translateToString(true) : '');
        }
        while (text.length > 0 && text[text.length - 1] === '') {
            text.pop();
        }
        return { text, window: win, state: bufferState(this.#term) };
    }
    state() {
        this.#assertAlive();
        return bufferState(this.#term);
    }
    dispose() {
        if (this.#disposed)
            return;
        this.#disposed = true;
        try {
            this.#pty.kill();
        }
        catch {
            // already dead
        }
        this.#term.dispose();
    }
}
//# sourceMappingURL=TerminalSession.js.map