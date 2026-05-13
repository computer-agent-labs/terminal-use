#!/usr/bin/env node
process.title = 'terminal-use';
import { version } from 'node:process';
const parts = version.substring(1).split('.').map(Number);
const major = parts[0] ?? 0;
const minor = parts[1] ?? 0;
if (major < 20 || (major === 20 && minor < 19) || (major === 22 && minor < 12)) {
    console.error(`ERROR: terminal-use does not support Node ${process.version}. Please upgrade to Node 20.19.0 LTS, 22.12.0 LTS, or newer.`);
    process.exit(1);
}
await import('./terminal-use-main.js');
//# sourceMappingURL=terminal-use.js.map