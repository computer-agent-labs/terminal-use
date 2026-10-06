# terminal-use

An [MCP](https://modelcontextprotocol.io) server that lets an AI agent use a real terminal the way a person does: type, press keys, click, read the screen, take a screenshot.

Most agent shell tools run a command and hand back its output. That breaks down for anything interactive — `vim`, `htop`, a REPL, an installer asking questions, `git rebase -i`, an SSH session. terminal-use gives the agent a shell on a real pseudo-terminal, rendered by a real terminal emulator, so full-screen and interactive programs work and the agent sees what you would see.

- **Real PTY, real emulator** — colors, cursor movement and the alternate screen are interpreted, not passed along as escape codes.
- **Text and pixels** — read the screen as plain text, or as a PNG when layout and color matter.
- **Waits properly** — block until a command actually finishes, or until some text appears.
- **Watch along** — attach your own terminal to any session and type alongside the agent.

## Quick start

Requires Node.js 20.19 or newer, on macOS or Linux.

**Claude Code**

```bash
claude mcp add terminal-use --scope user -- npx -y terminal-use
```

**Other MCP clients** (Claude Desktop, Cursor, and anything else that takes a command):

```json
{
  "mcpServers": {
    "terminal-use": {
      "command": "npx",
      "args": ["-y", "terminal-use"]
    }
  }
}
```

Start a new session in your client and ask it to do something in a terminal, for example: *"Open vim, write a haiku into /tmp/haiku.txt, save and quit, then show me a screenshot of `cat`-ing it."*

Server options go after the command: `npx -y terminal-use --cols 100 --rows 40`.

| Option | Default | |
|---|---|---|
| `--shell <path>` | `$SHELL` or `/bin/bash` | Shell to run in new sessions |
| `--cwd <path>` | where the server was started | Working directory for new sessions |
| `--cols <n>` / `--rows <n>` | `120` / `30` | Terminal size |
| `--scrollback <n>` | `5000` | Lines of history kept |
| `--login` | off | Start shells as login shells (see below) |

### "command not found" inside a session

If programs that work in your own terminal (`node`, `brew`, `pyenv`…) are missing inside a session, the server probably inherited a bare environment. That happens when the MCP client is started from the Dock or a launcher instead of a terminal: your `PATH` is set up by your shell's profile files (`~/.zprofile`, `~/.bash_profile`, `~/.profile`), and nothing has read them.

A login shell reads those files. Turn it on for every session with the `--login` server flag, or for one session with `login: true` on `terminal_create`. It is off by default because it makes each shell slower to start and runs whatever your profile runs.

## Tools

Every tool except `terminal_create` and `terminal_list` takes the `sessionId` that `terminal_create` returns.

| Tool | What it does |
|---|---|
| `terminal_create` | Start a session: an interactive shell, or one program with `command`. Optional `label`, `cols`, `rows`, `shell`, `cwd`, `env`, `login`, `scrollback`, `theme`. |
| `terminal_list` | List sessions. |
| `terminal_destroy` | End a session. |
| `terminal_type` | Type text. `\n` presses Enter. `paste: true` sends it as one paste. |
| `terminal_press` | Press a key or combination: `Enter`, `Ctrl+C`, `ArrowUp`, `Shift+Tab`, `Alt+Enter`, `F5`… |
| `terminal_wait` | Wait for the running command to finish, for a regex to appear, or for output to go quiet. |
| `terminal_read` | Read the screen or scrollback as text. |
| `terminal_screenshot` | Render the screen as a PNG. |
| `terminal_click` | Left-click a cell, with a preview step. |
| `terminal_scroll` | Turn the mouse wheel over a cell. |
| `terminal_batch` | Send several inputs in one call and get the screen back once. |
| `terminal_resize` | Change the terminal size. |
| `terminal_reset` | Clear the screen and scrollback, or restart the shell with `hardReset: true`. |

## The skill

terminal-use comes with an [Agent Skill](https://agentskills.io): a short guide for the agent on how to use these tools well — when to use a command session, how to wait, how to read what is selected — plus recipes for vim, pagers, REPLs, menu-driven programs, ssh prompts and end-to-end testing of a TUI. It lives in [`skills/terminal-use`](skills/terminal-use).

- **Hosts that load skills from MCP servers** get it automatically. The server implements the MCP Skills extension (`io.modelcontextprotocol/skills`): the skill is listed by `skills/list` and its files are served as `skill://terminal-use/...` resources. Few hosts support this yet.
- **Hosts that load skills from disk** can install the same files. For Claude Code:

  ```bash
  cp -r "$(npx -y terminal-use skills-dir)/terminal-use" ~/.claude/skills/
  ```

The skill is optional. Without it the agent still has the tool descriptions and the server's built-in instructions.

## Shell sessions and command sessions

By default a session is an interactive shell: type commands into it as you would at a prompt.

Pass `command` to `terminal_create` to run one program in the terminal instead:

```json
{"command": "npm test -- --watch", "cwd": "/path/to/project", "env": {"CI": "1"}}
```

The command goes through the shell (`shell -c`), so quoting, pipes and redirection work. Input goes straight to the program. When it exits:

- its exit status is reported (by the call that was in progress, by `terminal_wait`, and in `terminal_list`);
- the final screen stays readable with `terminal_read` and `terminal_screenshot`;
- input tools return an error with the exit status rather than restarting anything;
- `terminal_reset` with `hardReset: true` runs it again, and `terminal_destroy` removes it.

This is the mode for testing a CLI or TUI: launch it, drive it, check how it ended.

## Watching and typing along

`terminal_create` returns a command you can run in your own terminal to join the session:

```
node /path/to/terminal-use/bin/terminal-use.js attach 3 --socket /tmp/terminal-use-501/terminal-use-41234-3.sock
```

You see what the agent sees and can type into the same shell. It works like a shared `tmux` session: several people can attach at once, and **Ctrl+]** detaches.

- You get the current screen and recent scrollback on connect, not a blank terminal.
- `--resize` makes the session follow your window size. By default the session keeps its own.
- `--socket` picks the server. Each MCP client runs its own terminal-use, and they all number sessions from 1; without `--socket`, `attach <id>` works when only one running server has that id and lists the candidates otherwise.
- Sockets are per-user (`0600`, inside a `0700` directory under the system temp dir). Anyone who can connect gets a shell as you, so they are not exposed any further than that.

## How it works

```
agent ──MCP──▶ terminal-use ──▶ node-pty ──▶ your shell
                  │
                  └─ @xterm/headless  ◀── everything the shell prints
                        │
                        ├─ terminal_read        (text)
                        └─ terminal_screenshot  (PNG)
```

[`node-pty`](https://github.com/microsoft/node-pty) runs the shell on a pseudo-terminal. Everything it prints is fed to a headless [xterm.js](https://xtermjs.org) emulator, and that emulator's buffer is the single source of truth: reads and screenshots both come from it, so the agent gets the rendered screen rather than a stream of escape codes.

## Details

### Waiting for things

`terminal_type`, `terminal_press` and `terminal_click` return once output has been quiet for a moment (`idleMs`, default 200 ms) and never wait longer than 10 seconds. That suits keystrokes. It doesn't suit a build, which can be silent for a while long before it is done. For anything slow, follow up with `terminal_wait`:

- **Default — wait for the command to finish.** terminal-use asks the kernel which process owns the terminal's foreground. A shell hands the terminal to each command it runs and takes it back afterwards, so when the shell owns it again, the prompt is back. This needs no shell integration or prompt parsing, and works for commands that print nothing.
- **`pattern` — wait for a regex to match the screen.** For things that never exit (`Listening on port`), REPL prompts, or a particular state of a TUI. `^` and `$` match at line starts and ends; a leading `(?i)` or `(?s)` sets further flags.
- **`until: "quiet"` — wait for output to stop** for `quietMs` (default 1 s). The same rule the typing tools use, without the 10-second cap.

In a command session, the default mode waits for the program to exit and reports its exit status.

`timeoutMs` defaults to 30 seconds (maximum 10 minutes). A timeout isn't an error: the response says the command is still running, and you can wait again.

Limits worth knowing: background jobs (`cmd &`) don't count as running. Inside a nested program such as `ssh` or a REPL, the outer shell doesn't get the foreground back until that program exits, so use `pattern` or `until: "quiet"` there. No exit status is reported; run `echo $?`.

### Reading the screen

`terminal_read` returns text in screen-sized pages: `page: 0` is the current screen, `page: 1` the one before it, and so on back through scrollback.

Lines the terminal wrapped at its right edge are joined back into the single line the program printed (`joinWrapped: false` gives one line per screen row).

Text can't show color, so it can't show which menu entry is selected. Reads therefore end with a list of what is highlighted on screen — text in reverse video or on a background color — with the row and columns `terminal_click` takes:

```
Highlighted on screen (reverse video or background color; screen row, columns):
  row 7, cols 3-18: "Unstaged changes"
```

If most of the screen is colored panels, the list is replaced by a pointer to `terminal_screenshot`. Turn it off with `highlights: false`.

The cursor is marked with `▌`. On an empty cell it simply takes the place of the blank. On a character it is inserted in front of that character, which shifts the rest of that one line right by a column; the header says which character it is on. The marker is left out while the program hides the cursor (most full-screen programs do), and `cursor: false` returns the text untouched.

### Screenshots

`terminal_screenshot` renders the screen with the bundled JetBrains Mono. Sessions take a `theme` at creation: `dark` (default), `light`, `solarized-dark` or `solarized-light`.

JetBrains Mono covers Latin, Greek, Cyrillic, box-drawing and common symbols. Emoji, Chinese/Japanese and Korean text fall back to fonts already on the system, because bundling them would add tens of megabytes:

| | Emoji | CJK | Hangul |
|---|---|---|---|
| macOS | Apple Color Emoji | Hiragino Sans GB / PingFang | Apple SD Gothic Neo |
| Linux | Noto Color Emoji | Noto Sans CJK | Noto Sans CJK |

macOS has these out of the box. On Debian or Ubuntu, install them with `apt install fonts-noto-color-emoji fonts-noto-cjk`. Without them (a bare Docker image, say) those characters render as empty boxes in screenshots. Nerd Font and Powerline icons render as boxes everywhere. `terminal_read` is unaffected and always returns the real characters.

### Typing, pasting and batching

`terminal_type` sends characters as keystrokes. For multi-line text going into an editor, a REPL or a shell prompt, add `paste: true`: programs that support bracketed paste receive it as one paste and insert it verbatim, without auto-indenting or running each line as it arrives. Programs that don't support it get the plain characters.

`terminal_batch` sends a list of inputs in one call and returns the screen once at the end, which saves a round trip per keystroke when the steps are already known:

```json
{
  "sessionId": 1,
  "actions": [
    {"type": "press", "key": "ArrowDown", "count": 3},
    {"type": "press", "key": "Enter"},
    {"type": "wait", "pattern": "Commit message"},
    {"type": "type", "text": "Fix typo"},
    {"type": "press", "key": "Ctrl+S"}
  ]
}
```

Actions are `type`, `paste`, `press`, `click`, `scroll` and `wait` (a fixed `ms`, or a `pattern` to appear). The batch is checked before anything is sent, and stops at the first action that fails, reporting how far it got.

### Clicking and scrolling

- Left button only. Coordinates are 1-indexed; `(1, 1)` is the top-left cell.
- **`preview` is on by default.** A preview returns a screenshot with a ring drawn around the target cell and sends no click. Repeat the call with `preview: false` to click. Full-screen programs often have destructive actions one click away, so it is worth the extra step.
- `terminal_scroll` turns the wheel over a cell. Programs that track the mouse get wheel events there, so the pane under the pointer scrolls; full-screen programs that don't (`less`, `man`) get arrow keys, as in a normal terminal. At a shell prompt there is nothing to scroll — read earlier output with `terminal_read` and `page`.
- A real click needs the program to have turned on mouse reporting — `vim` with `set mouse=a`, `fzf`, `lazygit`, `htop` and most modern TUIs do. At a plain shell prompt the call returns an error instead of printing escape codes into your command line.

### Session lifecycle

- Sessions are independent. Calls to one session run in order; calls to different sessions don't block each other.
- If a shell session's shell exits, the session sits idle for six hours, or the 50-session limit is reached, the session is shut down but its id stays reserved for 30 days. The next call to that id starts a fresh shell with the same size, shell, working directory and theme, and returns a notice saying what happened — including the last screen the old shell printed, if it exited on its own. The command in that call is *not* run; send it again if you still want it.
- Idle means no tool calls and no output. A dev server that is still printing is not idle.
- `terminal_destroy` ends a session for good; its id is not reserved.
- When the MCP client disconnects or the server is stopped, every shell is closed and every attach socket removed.

### Protocol support

Built on the official MCP TypeScript SDK (v2). Over stdio it speaks both the 2026-07-28 revision of the protocol, which is stateless, and the earlier handshake-based revisions; the client's first message decides which.

Stateless refers to the protocol, not the terminals: sessions live in the server process and are addressed by the `sessionId` you pass on each call. The server also provides usage instructions, titles and behavior hints for each tool, cancellation, progress updates from `terminal_wait`, and the Skills extension described above.

## Platform support

| | |
|---|---|
| macOS (arm64, x64) | Supported |
| Linux (arm64, x64) | Supported |
| Windows | Untested. It may start, but nothing has been run there. |

The native dependencies (`node-pty`, `@napi-rs/canvas`) ship prebuilt binaries, so no compiler is needed to install.

## Development

```bash
git clone https://github.com/computer-agent-labs/terminal-use.git
cd terminal-use
yarn install
yarn build      # compile src/ to dist/
yarn test       # build, then run the full suite
```

Other scripts:

```bash
yarn dev            # run the server straight from source
yarn lint           # eslint
yarn typecheck      # tsc, no output
yarn test:unit      # unit tests only
yarn smoke          # quick end-to-end check without an MCP client
```

To point your MCP client at a local checkout, build it and use the path to the bin script:

```bash
claude mcp add terminal-use --scope user -- node "$PWD/bin/terminal-use.js"
```

The code is laid out by layer: `src/pty` (spawning, key and mouse encoding), `src/emulator` (the xterm buffer, rendering, waiting), `src/session` (one terminal), `src/attach` (the socket you attach through) and `src/mcp` (the tools). The agent skill is in `skills/`.

## Security

terminal-use gives the connected client a shell on your machine, running as you, with no sandbox. Connect it only to clients you would trust with a terminal, and use your client's tool-approval settings to control what runs unprompted. It opens no network ports; attach sockets are restricted to your own user. See [SECURITY.md](SECURITY.md) for details and for how to report a vulnerability.

## Contributing

Issues and pull requests are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) covers setting up, running the tests, and what a good pull request looks like. This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE). The bundled JetBrains Mono fonts are licensed under the [SIL Open Font License](fonts/OFL.txt).
