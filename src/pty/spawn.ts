import * as nodePty from '@lydell/node-pty'

export interface SpawnOptions {
  shell?: string
  cwd?: string
  cols: number
  rows: number
  /**
   * Run this command line (through `shell -c`) instead of an interactive
   * shell. The session's process is then the command itself: when it exits,
   * the session is over.
   */
  command?: string
  /** Variables set on top of the server's own environment. */
  env?: Record<string, string>
  /**
   * Start the shell as a login shell (`-l`), so it reads the user's profile
   * files (~/.zprofile, ~/.bash_profile, ~/.profile). That is where PATH is
   * usually set up, and a server started from a GUI app never inherited it.
   */
  login?: boolean
}

export type IPty = nodePty.IPty

export function defaultShell(): string {
  if (process.platform === 'win32') {
    return process.env.COMSPEC ?? 'powershell.exe'
  }
  return process.env.SHELL ?? '/bin/bash'
}

export function spawnPty(options: SpawnOptions): IPty {
  const cleanEnv: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === 'string') cleanEnv[k] = v
  }
  Object.assign(cleanEnv, options.env)
  cleanEnv.TERM = cleanEnv.TERM ?? 'xterm-256color'

  // `shell -c` rather than exec'ing the words ourselves: the caller gets
  // quoting, pipes, redirection and PATH lookup exactly as at a prompt.
  const args = [
    ...(options.login ? ['-l'] : []),
    ...(options.command === undefined ? [] : ['-c', options.command])
  ]
  return nodePty.spawn(options.shell ?? defaultShell(), args, {
    name: 'xterm-256color',
    cols: options.cols,
    rows: options.rows,
    cwd: options.cwd ?? process.cwd(),
    env: cleanEnv
  })
}
