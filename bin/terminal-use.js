#!/usr/bin/env node

// Bin shim: registers tsx so the TS sources can be imported directly,
// then re-enters into the real bin entrypoint. No build step required —
// tsx transpiles every .ts file on the fly in-process. ~50ms startup
// cost, ~3MB on-disk via the `tsx` dependency, in exchange for never
// having to commit a build/ directory.

import {register} from 'tsx/esm/api'

register()

await import('../src/bin/terminal-use-main.ts')
