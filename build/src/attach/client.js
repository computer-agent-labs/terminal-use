import { readdirSync, statSync } from 'node:fs';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { encodeData, encodeDetach, encodeResize, FRAME_DATA, FrameDecoder } from './framing.js';
const DETACH_BYTE = 0x1d; // Ctrl+]
function findSocket(sessionId) {
    const dir = tmpdir();
    const suffix = `-${sessionId}.sock`;
    const candidates = [];
    let entries = [];
    try {
        entries = readdirSync(dir);
    }
    catch {
        return undefined;
    }
    for (const name of entries) {
        if (!name.startsWith('terminal-use-') || !name.endsWith(suffix))
            continue;
        const path = join(dir, name);
        try {
            const st = statSync(path);
            candidates.push({ path, mtime: st.mtimeMs });
        }
        catch {
            // ignore
        }
    }
    if (candidates.length === 0)
        return undefined;
    candidates.sort((a, b) => b.mtime - a.mtime);
    return candidates[0].path;
}
function getTerminalSize() {
    const out = process.stdout;
    return { cols: out.columns ?? 80, rows: out.rows ?? 24 };
}
function printUsage() {
    console.error([
        'terminal-use attach - connect to a running terminal-use session',
        '',
        'Usage: terminal-use attach <sessionId> [--resize] [--socket=PATH]',
        '',
        'Options:',
        '  --resize          On attach (and on every SIGWINCH while attached),',
        '                    resize the session to match this terminal\'s size.',
        '                    Default: leave session size alone.',
        '  --socket <path>   Explicit socket path. Useful when multiple terminal-use',
        '                    servers are running and the auto-discovered one is',
        '                    not the one you want.',
        '  -h, --help        Show this help',
        '',
        'Press Ctrl+] to detach.'
    ].join('\n'));
}
export async function runAttachClient(rawArgs) {
    const parsed = parseArgs({
        args: rawArgs,
        options: {
            resize: { type: 'boolean' },
            socket: { type: 'string' },
            help: { type: 'boolean', short: 'h' }
        },
        allowPositionals: true,
        strict: true
    });
    if (parsed.values.help) {
        printUsage();
        process.exit(0);
    }
    const positional = parsed.positionals;
    if (positional.length !== 1) {
        printUsage();
        process.exit(1);
    }
    const sessionId = Number.parseInt(positional[0], 10);
    if (!Number.isFinite(sessionId) || sessionId < 1) {
        console.error(`Invalid sessionId: ${positional[0]}`);
        process.exit(1);
    }
    const socketPath = parsed.values.socket ?? findSocket(sessionId);
    if (!socketPath) {
        console.error(`Could not find a socket for session ${sessionId}. Looked under ${tmpdir()} ` +
            'for `terminal-use-*-' +
            sessionId +
            '.sock`. The terminal-use MCP server may not be running, or this session id ' +
            "doesn't exist. Try --socket=PATH if you know the exact path.");
        process.exit(1);
    }
    const resizeOnAttach = parsed.values.resize === true;
    await connectAndPipe(socketPath, sessionId, resizeOnAttach);
}
function connectAndPipe(socketPath, sessionId, resizeOnAttach) {
    return new Promise((resolve, reject) => {
        const socket = createConnection(socketPath);
        let restored = false;
        const restore = () => {
            if (restored)
                return;
            restored = true;
            try {
                if (process.stdin.isTTY)
                    process.stdin.setRawMode(false);
            }
            catch {
                // ignore
            }
            try {
                process.stdin.pause();
            }
            catch {
                // ignore
            }
        };
        const onSigwinch = () => {
            if (!resizeOnAttach)
                return;
            const { cols, rows } = getTerminalSize();
            try {
                socket.write(encodeResize(cols, rows));
            }
            catch {
                // ignore
            }
        };
        socket.on('connect', () => {
            console.error(`[terminal-use] attached to session ${sessionId} via ${socketPath}. Press Ctrl+] to detach.`);
            if (resizeOnAttach) {
                const { cols, rows } = getTerminalSize();
                socket.write(encodeResize(cols, rows));
                process.on('SIGWINCH', onSigwinch);
            }
            const decoder = new FrameDecoder();
            socket.on('data', chunk => {
                for (const frame of decoder.push(chunk)) {
                    if (frame.type === FRAME_DATA) {
                        process.stdout.write(frame.payload);
                    }
                }
            });
            if (process.stdin.isTTY) {
                try {
                    process.stdin.setRawMode(true);
                }
                catch {
                    // not fatal — still pipe, just with cooked-mode line buffering
                }
            }
            process.stdin.resume();
            process.stdin.on('data', chunk => {
                // Scan for the detach byte. If present, send everything up to it,
                // then DETACH, then stop.
                const idx = chunk.indexOf(DETACH_BYTE);
                if (idx === -1) {
                    socket.write(encodeData(chunk));
                    return;
                }
                if (idx > 0)
                    socket.write(encodeData(chunk.subarray(0, idx)));
                try {
                    socket.write(encodeDetach());
                }
                catch {
                    // ignore
                }
                socket.end();
            });
        });
        socket.on('error', err => {
            restore();
            process.off('SIGWINCH', onSigwinch);
            reject(err);
        });
        socket.on('close', () => {
            restore();
            process.off('SIGWINCH', onSigwinch);
            console.error('\n[terminal-use] detached.');
            resolve();
        });
        const onSignal = () => {
            try {
                socket.write(encodeDetach());
            }
            catch {
                // ignore
            }
            socket.end();
        };
        process.once('SIGTERM', onSignal);
        process.once('SIGHUP', onSignal);
    });
}
//# sourceMappingURL=client.js.map