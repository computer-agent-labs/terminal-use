#!/usr/bin/env node

// Bin shim: checks the Node version, then hands over to the compiled
// entrypoint in dist/. Kept as plain JS with no static imports so the check
// runs before anything an old Node would fail to load.

process.title = 'terminal-use'

const [major = 0, minor = 0] = process.versions.node.split('.').map(Number)

if (major < 20 || (major === 20 && minor < 19) || (major === 22 && minor < 12)) {
  console.error(
    `ERROR: terminal-use does not support Node ${process.version}. Please upgrade to Node 20.19.0 LTS, 22.12.0 LTS, or newer.`
  )
  process.exit(1)
}

try {
  await import('../dist/bin/terminal-use-main.js')
} catch (err) {
  // Only the entrypoint itself being absent means "not built" — a missing
  // module further down is a real error and must surface as one.
  if (err?.code === 'ERR_MODULE_NOT_FOUND' && String(err.message).includes('terminal-use-main.js')) {
    console.error('ERROR: terminal-use has not been built. Run `yarn build` in the repository first.')
    process.exit(1)
  }
  throw err
}
