import {execFileSync} from 'node:child_process'
import {dirname, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// The protocol suite spawns the real binary, which runs from dist/. Build it
// once up front so those tests never exercise a stale or missing build.
export default function setup(): void {
  execFileSync(resolve(ROOT, 'node_modules/.bin/tsc'), ['-p', 'tsconfig.build.json'], {cwd: ROOT, stdio: 'inherit'})
}
