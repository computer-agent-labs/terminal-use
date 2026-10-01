import {readFileSync} from 'node:fs'

// package.json is the single source of truth. It sits one level above this
// file both in the source tree (src/) and in the published build (dist/).
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {version: string}

export const VERSION = pkg.version
