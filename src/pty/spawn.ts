import * as nodePty from '@lydell/node-pty'

export interface SpawnOptions {
  shell?: string
  cwd?: string
  cols: number
  rows: number
  env?: Record<string, string | undefined>
}

export type IPty = nodePty.IPty

export function defaultShell(): string {
  if (process.platform === 'win32') {
    return process.env.COMSPEC ?? 'powershell.exe'
  }
  return process.env.SHELL ?? '/bin/bash'
}

export function spawnPty(options: SpawnOptions): IPty {
  const env = options.env ?? process.env
  const cleanEnv: Record<string, string> = {}
  for (const [k, v] of Object.entries(env)) {
    if (typeof v === 'string') cleanEnv[k] = v
  }
  cleanEnv.TERM = cleanEnv.TERM ?? 'xterm-256color'

  return nodePty.spawn(options.shell ?? defaultShell(), [], {
    name: 'xterm-256color',
    cols: options.cols,
    rows: options.rows,
    cwd: options.cwd ?? process.cwd(),
    env: cleanEnv
  })
}
