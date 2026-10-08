---
name: terminal-use
description: Drive interactive terminal programs through the terminal-use MCP tools (terminal_create, terminal_type, terminal_press, terminal_batch, terminal_wait, terminal_read, terminal_screenshot). Use when a task needs a real terminal rather than a one-shot shell command - full-screen or interactive programs (vim, less, htop, fzf, lazygit, REPLs, debuggers, installers, ssh, git rebase -i), testing a CLI or TUI end to end, or long-running commands and dev servers that have to be watched.
license: MIT
metadata:
  author: Computer Agent Labs
  version: "1.0"
---

# Driving a terminal with terminal-use

terminal-use gives you a terminal the way a person has one: a program running on a real PTY, drawn by a terminal emulator. You send input, you look at the screen. Nothing is returned to you as "command output" - you read what is on screen, exactly as a person would.

Use it for anything a one-shot shell command cannot do: programs that take over the screen, ask questions, keep running, or need keys rather than arguments. For a plain non-interactive command, an ordinary shell tool is simpler and cheaper.

## The loop

1. **Create** a session with `terminal_create`. Keep the `sessionId`; every other tool takes it.
2. **Act**: `terminal_type` (text), `terminal_press` (keys), `terminal_batch` (several inputs at once).
3. **Wait** if the result is not instant: `terminal_wait`.
4. **Look**: the input tools return the screen already. Use `terminal_read` to look again, `terminal_screenshot` when color or layout matters.
5. **Destroy** the session with `terminal_destroy` when you are done.

## Choosing the session type

- **Shell session** (default): an interactive shell. Use it when you will run several commands, or need shell state (cwd, variables, an activated environment).
- **Command session**: pass `command` to `terminal_create` (for example `"vim notes.txt"` or `"npm test"`). The session *is* that program. Use it to run one program, and always when you need to know how it ended: its exit status is reported when it exits, and its final screen stays readable afterwards. It is never restarted behind your back.

On Windows the default shell is PowerShell: use PowerShell syntax (`$env:NAME`, `;` between commands), or pass `shell: "cmd.exe"`.

Set `cwd` and `env` at creation rather than typing `cd` and `export`. If tools the user has installed are "command not found", create the session with `login: true`.

## Sending input

- `terminal_type` types characters. `\n` presses Enter, so `"ls -la\n"` runs the command and `"ls -la"` only types it.
- `terminal_press` sends named keys: `Enter`, `Escape`, `Tab`, `Backspace`, `ArrowUp`, `PageDown`, `F5`, `Ctrl+C`, `Alt+Enter`, `Shift+Tab`. Plain letters and digits go through `terminal_type`, not `terminal_press`. See [references/keys.md](references/keys.md) for the full list.
- For multi-line text going into an editor, a REPL or a prompt, use `terminal_type` with `paste: true`. Typed line by line, an editor will auto-indent it and a shell will run each line as it arrives.
- When you already know the next several inputs, send them in one `terminal_batch` call. It returns the screen once, at the end, and stops at the first step that fails.

```json
{"sessionId": 1, "actions": [
  {"type": "press", "key": "ArrowDown", "count": 3},
  {"type": "press", "key": "Enter"},
  {"type": "wait", "pattern": "Commit message"},
  {"type": "type", "text": "Fix typo"}
]}
```

Batch only what you are sure of. If the next key depends on what the screen shows, send one step and look.

## Waiting

The input tools return once output has been quiet for a moment, and never wait more than 10 seconds. That is enough for a keystroke and not for a build. **Do not sleep or poll `terminal_read` in a loop** - call `terminal_wait`:

- no arguments: waits until the running command finishes and the shell is back at its prompt. In a command session: until the program exits.
- `pattern`: waits until a regex matches the screen. Use it for things that never exit ("Listening on port 3000"), for prompts inside ssh or a REPL, and for a TUI reaching a state. `^` and `$` match at line boundaries.
- `until: "quiet"`: waits until output stops. A last resort when neither of the above fits.

A timeout is not a failure. It means "still running": wait again, or press `Ctrl+C`.

Text that is already on screen satisfies a pattern. Choose one that only the *new* output can match.

## Reading the screen

- `terminal_read` is exact and cheap. Prefer it.
- The cursor is marked `▌`. That character is not part of the text.
- Reads end with a **Highlighted on screen** list. Full-screen programs show the selected item with color, which text cannot carry; this list tells you which menu entry, tab or button is selected, with its row and columns.
- Scrollback: `page: 1` is the screen before the current one, `page: 2` the one before that.
- Use `terminal_screenshot` when the read says most of the screen is colored, when alignment or styling is the point, or to show the user what you see.

## Full-screen programs

- Look before you act. After starting one, read the screen to see what state it is in.
- Navigate with keys first. They are more reliable than the mouse and work everywhere.
- `terminal_click` previews by default: the first call returns a picture with the target circled and sends nothing; repeat it with `preview: false` to click. The row and columns from the Highlighted list are click coordinates.
- `terminal_scroll` turns the mouse wheel. To see earlier *shell* output, use `terminal_read` with `page` instead.
- Leave a program by its own exit command (`:q`, `q`, `Ctrl+D`, `exit`) before running the next thing in the same shell.

Worked examples for vim, pagers, REPLs, menu-driven programs, ssh and password prompts, `git rebase -i`, and testing a program end to end are in [references/recipes.md](references/recipes.md).

## Things that go wrong

- **"A fresh shell has been spawned"**: the session's shell had ended (it exited, sat idle, or was evicted). The input in that call was **not** sent. Shell state is gone (cwd, variables, anything that was running). Re-establish what you need and send the command again.
- **"There is no process left to send input to"**: a command session's program has exited. Read its final screen, then either `terminal_reset` with `hardReset: true` to run it again or `terminal_destroy`.
- **The command seems to have done nothing**: you probably typed it without `\n`. Press `Enter`.
- **The screen shows your typed text twice or garbled**: a full-screen program received shell input, or the other way round. Read the screen to see which program is in front.
- **A prompt is asking for a password or a decision that is the user's to make**: stop, tell the user, and give them the attach command from `terminal_create` so they can type it themselves. Do not guess, and do not ask the user to paste secrets into the chat.

More in [references/troubleshooting.md](references/troubleshooting.md).

## Keep the user in the loop

`terminal_create` returns an `attach` command. It lets the user watch the session and type into it from their own terminal. Offer it when they want to see what is happening, and whenever something needs their input directly (passwords, 2FA codes, confirmations you should not make for them). That command is for the user; do not run it yourself.
