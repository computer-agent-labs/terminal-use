#!/usr/bin/env node

// Bin shim: checks the Node version, registers tsx so the TS sources can be
// imported directly, then re-enters into the real bin entrypoint. No build
// step required — tsx transpiles every .ts file on the fly in-process.
// ~50ms startup cost, ~3MB on-disk via the `tsx` dependency, in exchange
// for never having to commit a build/ directory.
//
// The version check lives here, in plain JS with no static imports, so it
// runs before anything that an old Node would fail to load.

process.title = 'terminal-use'

const [major = 0, minor = 0] = process.versions.node.split('.').map(Number)

if (major < 20 || (major === 20 && minor < 19) || (major === 22 && minor < 12)) {
  console.error(
    `ERROR: terminal-use does not support Node ${process.version}. Please upgrade to Node 20.19.0 LTS, 22.12.0 LTS, or newer.`
  )
  process.exit(1)
}

const {register} = await import('tsx/esm/api')

register()

await import('../src/bin/terminal-use-main.ts')
