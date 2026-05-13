import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderToPng } from '../src/emulator/render.js';
import { TerminalSession } from '../src/session/TerminalSession.js';
async function main() {
    const session = new TerminalSession({ cols: 80, rows: 24 });
    console.log(`spawned shell pid=${session.pty.pid} ${session.term.cols}x${session.term.rows}`);
    // 1. Type "echo hello world" + Enter, settle
    let result = await session.writeText('echo hello world\n', { idleMs: 200, maxWaitMs: 5000 });
    console.log(`[1] type echo hello world: ${result.outcome} in ${result.elapsedMs}ms (${result.bytesObserved} bytes)`);
    let win = session.read(session.term.rows, 0);
    console.log('--- visible ---');
    for (const line of win.text)
        console.log(line);
    console.log('---');
    if (!win.text.some(line => line.includes('hello world'))) {
        throw new Error('expected hello world in visible buffer');
    }
    // 2. Resize
    await session.resize(40, 12);
    console.log(`[2] resized to ${session.term.cols}x${session.term.rows}, pty=${session.pty.cols}x${session.pty.rows}`);
    if (session.term.cols !== 40 || session.pty.cols !== 40)
        throw new Error('resize mismatch');
    // 3. tput cols should reflect new size
    result = await session.writeText('stty size\n', { idleMs: 300, maxWaitMs: 5000 });
    console.log(`[3] stty size: ${result.outcome}`);
    win = session.read(session.term.rows, 0);
    console.log('--- visible ---');
    for (const line of win.text)
        console.log(line);
    console.log('---');
    if (!win.text.some(line => /\b12 40\b/.test(line))) {
        console.warn('warning: expected "12 40" in stty output');
    }
    // 4. Press ArrowUp, then Enter -> re-runs last command
    await session.pressKey('ArrowUp', 1, { idleMs: 200, maxWaitMs: 5000 });
    await session.pressKey('Enter', 1, { idleMs: 300, maxWaitMs: 5000 });
    win = session.read(session.term.rows, 0);
    console.log('[4] after ArrowUp+Enter --- visible ---');
    for (const line of win.text)
        console.log(line);
    console.log('---');
    // 5. Print 200 lines and page through
    await session.writeText('for i in 1 2 3 4 5 6 7 8 9 10; do for j in 0 1 2 3 4 5 6 7 8 9; do echo line$i$j; done; done\n', { idleMs: 400, maxWaitMs: 8000 });
    win = session.read(50, 0);
    console.log(`[5] read({rows:50, page:0}) - bufferLength=${win.state.bufferLength}, totalPages=${win.window.totalPages}`);
    console.log(`    last 3 lines: ${win.text.slice(-3).join(' | ')}`);
    win = session.read(50, 1);
    console.log(`    page 1 first/last: ${win.text[0]} | ${win.text[win.text.length - 1]}`);
    // 6. Screenshot
    const png = renderToPng(session.term);
    const path = join(tmpdir(), `terminal-use-smoke-${Date.now()}.png`);
    await writeFile(path, png.buffer);
    console.log(`[6] screenshot ${png.width}x${png.height} (${png.buffer.length} bytes) saved to ${path}`);
    if (!png.buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
        throw new Error('PNG signature missing');
    }
    // 7. Soft reset preserves PID
    const oldPid = session.pty.pid;
    await session.softReset();
    if (session.pty.pid !== oldPid)
        throw new Error(`soft reset changed pid (${oldPid} -> ${session.pty.pid})`);
    console.log(`[7] soft reset: pid preserved (${session.pty.pid})`);
    // 8. Hard reset changes PID
    await session.hardReset({});
    if (session.pty.pid === oldPid)
        throw new Error('hard reset did not change pid');
    console.log(`[8] hard reset: pid changed (${oldPid} -> ${session.pty.pid})`);
    // 9. Ctrl+C aborts a sleep
    await session.writeText('sleep 30; echo finished\n', { idleMs: 200, maxWaitMs: 1000 });
    await new Promise(r => setTimeout(r, 200));
    await session.pressKey('Ctrl+C', 1, { idleMs: 300, maxWaitMs: 3000 });
    await session.writeText('echo aborted=$?\n', { idleMs: 300, maxWaitMs: 3000 });
    win = session.read(session.term.rows, 0);
    console.log('[9] after Ctrl+C --- visible ---');
    for (const line of win.text)
        console.log(line);
    console.log('---');
    session.dispose();
    console.log('all good');
}
main().catch(err => {
    console.error('SMOKE FAILED:', err);
    process.exit(1);
});
//# sourceMappingURL=smoke.js.map