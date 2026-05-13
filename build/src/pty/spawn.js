import * as nodePty from '@lydell/node-pty';
export function defaultShell() {
    if (process.platform === 'win32') {
        return process.env.COMSPEC ?? 'powershell.exe';
    }
    return process.env.SHELL ?? '/bin/bash';
}
export function spawnPty(options) {
    const env = options.env ?? process.env;
    const cleanEnv = {};
    for (const [k, v] of Object.entries(env)) {
        if (typeof v === 'string')
            cleanEnv[k] = v;
    }
    cleanEnv.TERM = cleanEnv.TERM ?? 'xterm-256color';
    return nodePty.spawn(options.shell ?? defaultShell(), [], {
        name: 'xterm-256color',
        cols: options.cols,
        rows: options.rows,
        cwd: options.cwd ?? process.cwd(),
        env: cleanEnv
    });
}
//# sourceMappingURL=spawn.js.map