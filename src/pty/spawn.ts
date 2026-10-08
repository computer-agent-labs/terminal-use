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

const IS_WINDOWS = process.platform === 'win32'

export function defaultShell(): string {
  // PowerShell rather than cmd.exe: it is what Windows Terminal opens, and
  // the commands an agent reaches for (ls, cat, rm, pipes of objects) exist.
  if (IS_WINDOWS) return 'powershell.exe'
  return process.env.SHELL ?? '/bin/bash'
}

type ShellFamily = 'posix' | 'powershell' | 'cmd'

export function shellFamily(shell: string): ShellFamily {
  const name = (shell.split(/[\\/]/).pop() ?? shell).toLowerCase().replace(/\.exe$/, '')
  if (name === 'powershell' || name === 'pwsh') return 'powershell'
  if (name === 'cmd') return 'cmd'
  return 'posix'
}

/**
 * Arguments that make `shell` either sit at an interactive prompt or run
 * one command line and exit with that command's status.
 */
export function shellArgs(shell: string, command: string | undefined, login: boolean): string[] {
  switch (shellFamily(shell)) {
    case 'powershell':
      if (command === undefined) return ['-NoLogo']
      // `-Command` alone exits 0 or 1. Pass on a native program's real exit
      // code when there is one, and 1 when a cmdlet failed.
      return [
        '-NoLogo',
        '-Command',
        `& { ${command} }; $ok = $?; if ($null -ne $LASTEXITCODE) { exit $LASTEXITCODE }; if (-not $ok) { exit 1 }`
      ]
    case 'cmd':
      return command === undefined ? [] : ['/d', '/s', '/c', command]
    case 'posix':
      // `shell -c` rather than exec'ing the words ourselves: the caller
      // gets quoting, pipes, redirection and PATH lookup exactly as at a
      // prompt. `-l` makes it a login shell.
      return [...(login ? ['-l'] : []), ...(command === undefined ? [] : ['-c', command])]
  }
}

export function spawnPty(options: SpawnOptions): IPty {
  const cleanEnv: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === 'string') cleanEnv[k] = v
  }
  Object.assign(cleanEnv, options.env)
  if (!IS_WINDOWS) {
    cleanEnv.TERM = cleanEnv.TERM ?? 'xterm-256color'
    // The emulator always decodes the pty as UTF-8. With no locale set at
    // all (a container, a service manager) programs fall back to the C
    // locale and treat multi-byte characters as separate bytes: line
    // editing over "你好" puts the cursor in the wrong place. Give them a
    // UTF-8 one; anything the user did set is left alone.
    if (!cleanEnv.LC_ALL && !cleanEnv.LC_CTYPE && !cleanEnv.LANG) {
      cleanEnv.LANG = process.platform === 'darwin' ? 'en_US.UTF-8' : 'C.UTF-8'
    }
  }

  const shell = options.shell ?? defaultShell()
  return nodePty.spawn(shell, shellArgs(shell, options.command, options.login === true), {
    name: 'xterm-256color',
    cols: options.cols,
    rows: options.rows,
    cwd: options.cwd ?? process.cwd(),
    env: cleanEnv
  })
}
