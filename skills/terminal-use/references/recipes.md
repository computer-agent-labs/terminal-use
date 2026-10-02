# Recipes

Each recipe shows the calls in order. `id` stands for the `sessionId` returned by `terminal_create`.

## Run a long command and get its result

In a shell session:

1. `terminal_type` `{sessionId: id, text: "npm run build\n"}`
2. `terminal_wait` `{sessionId: id, timeoutMs: 300000}` - returns when the shell prompt is back.
3. If you need the exit status: `terminal_type` `{text: "echo $?\n"}`.

If only the result matters, a command session is simpler:

1. `terminal_create` `{command: "npm run build", cwd: "/path/to/project"}`
2. `terminal_wait` `{sessionId: id, timeoutMs: 300000}` - the response states the exit code and shows the final screen.

For output longer than a screen, page back with `terminal_read` `{page: 1}`, `{page: 2}` and so on.

## Start a dev server and keep it running

1. `terminal_create` `{label: "dev-server", cwd: "/path/to/project"}`
2. `terminal_type` `{text: "npm run dev\n"}`
3. `terminal_wait` `{pattern: "(?i)(listening|ready|compiled)"}` - do not wait for the command to finish; it never does.
4. Work in a *second* session, or with other tools. Come back with `terminal_read` to check the log.
5. Stop it with `terminal_press` `{key: "Ctrl+C"}`.

## Edit a file in vim

Open it as a command session, so you learn whether vim exited cleanly:

1. `terminal_create` `{command: "vim /tmp/notes.txt"}`
2. `terminal_batch`:

```json
{"sessionId": 1, "actions": [
  {"type": "type", "text": "i"},
  {"type": "paste", "text": "first line\nsecond line"},
  {"type": "press", "key": "Escape"},
  {"type": "type", "text": ":wq\n"}
]}
```

Notes: `i`, `:wq` and other vim commands are typed, not pressed. Use `paste` for the content so auto-indent does not reshape it. If vim is in an unknown state, press `Escape` twice before a command.

## Read with a pager (less, man, git log)

- Next page: type `" "` (a space) or press `PageDown`. Previous: type `"b"` or press `PageUp`.
- Search: type `"/pattern\n"`, then `"n"` for the next match.
- Quit: type `"q"`.
- `terminal_scroll` also works here; in a pager it is sent as arrow keys.

To avoid the pager entirely, run the command with paging off (`git --no-pager log`, `PAGER=cat` in `env`) and read the output from scrollback.

## Use a REPL (python, node, psql)

1. Start it as a command session: `terminal_create` `{command: "python3"}`.
2. Wait for its prompt before the first input: `terminal_wait` `{pattern: "^>>>\\s*$"}`. (Trailing spaces are trimmed from each line of the screen, so do not match a space after the prompt.)
3. Send code with `terminal_type`. For more than one line, use `paste: true`, then press `Enter` (twice in Python, to close an indented block).
4. Wait for the prompt again rather than for "the command to finish" - inside a REPL the default wait cannot tell when an expression is done.
5. Exit with `Ctrl+D`. The response gives the exit code.

## Navigate a menu-driven program (lazygit, htop, an installer)

1. Read the screen. Find the selected item in the **Highlighted on screen** list at the end of the read.
2. Move with arrow keys (or `j`/`k` typed, where the program uses vim keys), then read again and check the highlight moved to what you want.
3. Confirm with `Enter`. Cancel with `Escape` or `q`.
4. Once you know the path through the menus, do it in one `terminal_batch`.

If the read says most of the screen is colored and lists no highlights, take a `terminal_screenshot` to see the selection.

Prefer keys to the mouse. If you do click, call `terminal_click` once to preview where it will land, then again with `preview: false`.

## fzf and other fuzzy finders

1. Type the query with `terminal_type` (no `\n`).
2. Read the screen: the highlighted row is the current match.
3. `ArrowUp` / `ArrowDown` to change it, `Enter` to accept, `Escape` to cancel.

## ssh, sudo and other prompts for secrets

1. Type the command: `"ssh user@host\n"`.
2. `terminal_wait` `{pattern: "(?i)(password|passphrase|verification code|yes/no)"}`.
3. If it asks to confirm a host key, that is the user's decision unless they already told you to accept it.
4. If it asks for a password, passphrase or code: stop. Tell the user what is being asked, and give them the `attach` command so they can type it into the session themselves. Never ask them to send a secret through the chat.
5. After they have done it, `terminal_wait` for the remote prompt with a `pattern`. Inside ssh the default wait does not work, because the local shell does not get the terminal back until ssh exits.

## git rebase -i, git commit, and anything that opens $EDITOR

These open the user's editor inside the session. Either drive that editor (see the vim recipe), or sidestep it:

- Set a predictable editor at creation: `env: {"GIT_EDITOR": "vim"}`.
- Or avoid the editor: `git commit -m "..."`, `GIT_SEQUENCE_EDITOR="sed -i.bak '2s/pick/squash/'" git rebase -i HEAD~3`.

After the editor closes, `terminal_wait` and read the result. A rebase may stop for conflicts; the screen says so.

## Test a CLI or TUI end to end

Use a command session per run, so each test starts clean and reports an exit code:

1. `terminal_create` `{command: "./mytool --flag", cwd: "...", cols: 100, rows: 30}` - fix the size so layout is reproducible.
2. `terminal_wait` `{pattern: "<text that shows it is ready>"}`
3. Drive it with `terminal_batch`.
4. Check the screen with `terminal_read`; take a `terminal_screenshot` if appearance is part of the test.
5. Exit the program the way a user would, then `terminal_wait`: the response gives the exit code. A non-zero code or a crash message on the final screen is your failure evidence.
6. `terminal_destroy`, or `terminal_reset` with `hardReset: true` to run it again.

To test how it behaves at another size, call `terminal_resize` while it is running and read the screen again.
