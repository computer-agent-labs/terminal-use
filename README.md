# terminal-use

An MCP server that gives an AI agent first-class control of a real
pseudo-terminal — the same way a human user drives a terminal: type
characters, press keys, watch output update, resize the window, take a
screenshot, reset and start over.

## Architecture

`node-pty` spawns a real shell. Its byte stream is fed into a headless
`@xterm/headless` terminal emulator that holds the authoritative
buffer. The emulator is the source of truth for both text reads and
PNG snapshots — that way the agent sees exactly what a user would see
(ANSI colors interpreted, alt-buffer switches honored, cursor where it
actually is), not the raw byte stream.

## Protocol

Built on the v2 MCP TypeScript SDK (`@modelcontextprotocol/server`). Over stdio it serves both protocol eras, chosen by the client's opening message:

- **2026-07-28**, the stateless revision — no `initialize` handshake, no protocol-level session; every request is self-contained.
- **2025-11-25 and earlier**, with the handshake, for clients that haven't moved yet.

"Stateless" describes the protocol, not the terminals. The 2026 spec's rule is that a server needing state across calls hands out an explicit handle and takes it back as an ordinary tool argument — which is what `sessionId` already is. Sessions live in the server process, outside any one connection's protocol state, so nothing about them depends on the era.

Also advertised: server `instructions` (how the tools fit together, read by the model before its first call), a `title` and behavior hints (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) on every tool, tools listed in a stable order, JSON Schema 2020-12 input schemas, request cancellation, and progress notifications from `terminal_wait` when the client supplies a progress token.

## Tools

### Per-session (act on a specific terminal)

Each of these requires `sessionId`. Get one by calling `terminal_create`.

| Tool | Purpose |
|---|---|
| `terminal_type` | Type literal characters; `\n` is normalized to Enter. |
| `terminal_press` | Press named keys/combos (`Enter`, `Ctrl+C`, `ArrowUp`, `Shift+Tab`, `Alt+Enter`, `F1`…). |
| `terminal_wait` | Block until the running command finishes, or until a regex appears on screen. See *Waiting* below. |
| `terminal_resize` | Change cols/rows; either is optional (preserves current). |
| `terminal_reset` | Wipe buffer; `hardReset: true` kills + respawns the shell. |
| `terminal_read` | Read the buffer, paginated in screen-sized windows. Cursor marked inline by default, without moving or hiding any text: `▌` when it sits on an empty cell, otherwise the character it is on is underlined (combining U+0332) and named in the header (`cursor is on the underlined "d"`). Omitted while the program hides the cursor; `cursor: false` returns the text untouched. |
| `terminal_screenshot` | PNG of the current screen (or any earlier screen-sized window via `page`). The cursor is a block in inverse video — the character under it stays readable — and is left out while the program hides it. |
| `terminal_click` | Left-click at a (col, row) cell. See *Click semantics* below. |

### Session management

| Tool | Purpose |
|---|---|
| `terminal_create` | Spawn a new session and return its numeric id; optional `label` for `terminal_list` display. |
| `terminal_list` | List live sessions and tombstoned ids. |
| `terminal_destroy` | Kill a session and forget the id entirely. |

### Waiting

`terminal_type`, `terminal_press` and `terminal_click` return once output has been quiet for `idleMs` (default 200 ms), and never wait longer than 10 s — `maxWaitMs` above that is clamped. That is the right behavior for keystrokes, and the wrong one for a build: a command that prints nothing for a while looks "settled" long before it is done.

`terminal_wait` is for everything slower:

- **No `pattern` — wait for the command to finish.** It asks the kernel which process group owns the terminal's foreground (`ps -o tpgid=,pgid=` on the shell). An interactive shell hands the terminal to each command it runs and takes it back afterwards, so "the shell owns the foreground again, and output has been quiet for `quietMs`" means the prompt is back. No shell integration, prompt parsing or rc-file changes are involved, and it stays correct for commands that are silent (`sleep 60`) or never stop printing.
- **With `pattern` — wait for a regex to match the screen** (the viewport plus the 200 rows above it). Use this for things that never exit (`Listening on`), REPL prompts, and TUI states. A leading `(?i)` / `(?m)` / `(?s)` is accepted as a flag prefix.
- **`until: "quiet"` — wait for output to stop** for `quietMs` (default 1 s), whoever owns the terminal. The same "settled" rule the typing tools use, without their 10 s cap; for nested programs where neither of the above fits.
- `timeoutMs` defaults to 30 s (max 10 min). Running out of time is not an error; the response says the command is still running and you can call `terminal_wait` again.

Limits: background jobs (`cmd &`) don't count as running; inside a nested program (ssh, a REPL, a TUI) the outer shell doesn't regain the foreground until that program exits, so use `pattern` there; no exit status is reported (run `echo $?`). On Windows, or where `ps` is unavailable, the foreground can't be queried and the tool falls back to a 2 s output-quiet heuristic and says so.

### Themes

`terminal_screenshot` and `terminal_click`'s preview PNG render using the session's theme. The theme is picked at `terminal_create` time via the `theme` arg, and persists across `terminal_reset({hardReset: true})` and auto-respawn:

| theme name | description |
|---|---|
| `dark` *(default)* | VS Code Dark+ — dark background (`#1e1e1e`) with bright ANSI palette. |
| `light` | VS Code Light+ — white background, dark text. |
| `solarized-dark` | Ethan Schoonover's Solarized, dark variant. |
| `solarized-light` | Solarized, light variant. |

Pass e.g. `terminal_create({label: 'work', theme: 'solarized-dark'})`. `terminal_list` shows each session's theme in the descriptor line.

### Renderer glyph coverage

`terminal_screenshot` and `terminal_click`'s preview PNG use **JetBrains Mono Regular + Bold** as the bundled fonts. That covers Latin, Greek, Cyrillic, ANSI box-drawing (`┌─┬─┐` etc.), and most general-purpose symbols.

**Emoji, CJK** (`你好`, Japanese kana — including kaomoji such as `¯\_(ツ)_/¯`) **and Hangul** (`한글`) are not in JetBrains Mono, and we don't bundle Noto for them (~10 MB for emoji, ~7 MB per CJK region). The renderer falls back to fonts the OS already has:

| | emoji | CJK | Hangul |
|---|---|---|---|
| **macOS** | Apple Color Emoji | Hiragino Sans GB / PingFang | Apple SD Gothic Neo |
| **Linux** | Noto Color Emoji | Noto Sans CJK | Noto Sans CJK |

macOS ships all of these. On Linux they are optional packages — `apt install fonts-noto-color-emoji fonts-noto-cjk` on Debian/Ubuntu (verified in `node:22-bookworm`); the Fedora, Arch and Alpine package locations are probed too but untested. Where the fonts aren't installed (a bare Docker image), those cells render as tofu boxes.

**Nerd Font / Powerline icons** that live in the supplementary Private Use Area render as tofu on every platform — we don't bundle a Nerd Font.

The text path (`terminal_read`) is unaffected — it returns the exact codepoints from xterm-headless's buffer, faithfully including everything. So when working with content that has tofu'd glyphs in the PNG, prefer `terminal_read` for ground truth and use the screenshot to spot-check layout / colors / ANSI styling.

### Click semantics

- **Left-button only**, no modifiers, no right/middle/wheel (v1 scope).
- **Coordinates are 1-indexed**: `(col 1, row 1)` is the top-left cell of the live viewport, `(term.cols, term.rows)` is the bottom-right.
- **`preview` defaults to `true`.** A preview call renders a PNG with a bright magenta ring + dark halo + center dot drawn at the target cell, plus a `(col N, row M)` coordinate label off to the side. *No click is sent.* The agent inspects the preview and then, if the target is right, repeats with `preview: false`.
- **Execute mode requires the foreground program to have enabled mouse tracking.** Vim with `set mouse=a`, fzf, lazygit, less with `--mouse`, and most modern TUIs auto-enable it on startup. At a plain shell prompt, mouse mode is off and an execute call returns `isError: true` with an explanatory message rather than printing junk escape sequences as text.
- **Wire-level encoding follows what the program asked for**: SGR (`CSI <0;col;row M` press, `m` release) when it enabled mode 1006, which every modern TUI does; otherwise legacy X10 bytes, which can only address cells up to column/row 95. Press + release are sent atomically.
- **Known cosmetic limit**: when the target is in the rightmost ~10 columns, the coordinate label drawn next to the ring may clip off the canvas. The ring itself is always in frame, so trust it over the label.
- **`idleMs` / `maxWaitMs` are accepted but ignored in preview mode** (preview never settles).

### Attach (tmux-style human attach)

You can attach to any live session from your own terminal and watch / type alongside the agent.

`terminal_create` prints the attach command in its response — the agent can quote it back to you:

```
node /abs/path/terminal-use/bin/terminal-use.js attach 3 --socket /tmp/terminal-use-501/terminal-use-41234-3.sock
```

What it does:

- Connects to a per-session Unix domain socket, `terminal-use-<server-pid>-<sessionId>.sock`, inside a private per-user directory `<tmpdir>/terminal-use-<uid>/` (directory 0700, socket 0600 — same Unix user only). `<tmpdir>` is `/tmp` on Linux and `/var/folders/…/T` on macOS.
- **`--socket` pins the command to one server.** Every MCP client starts its own terminal-use server and each numbers its sessions from 1, so `attach 1` alone is often ambiguous. Without `--socket` the client looks the id up among running servers: one match attaches, several are listed for you to choose from. Sockets left behind by servers that no longer exist are deleted during the lookup.
- On attach you are sent the session's current screen and up to 1000 lines of scrollback, so an idle shell or a running TUI appears immediately rather than after its next redraw. It is drawn for the session's size; pass `--resize` if your window differs.
- The PTY's output is broadcast to every attached client *and* the xterm-headless buffer the agent reads from. The agent and any attached humans are peers on the same PTY.
- Multiple concurrent attaches are allowed (tmux-style). All clients see the same output; any client's typing reaches the shell.
- Press **Ctrl+]** to detach. Your terminal is put back in order on the way out (alternate screen, mouse reporting, bracketed paste, cursor visibility), since the program in the session is still running and will never send those resets itself.
- Pass `--resize` to make the human's terminal size override the session's (and SIGWINCH-resize the session as the human resizes their window). Default is to leave the session size alone.
- The socket survives across shell-exit / idle-kill / eviction — your connection stays open and you'll see new output as soon as the next tool call against this id triggers a respawn. It goes away on `terminal_destroy`, when the 30-day tombstone retention expires, and when the server shuts down.
- If the socket can't be created, the session still works; only attach is unavailable.

### Lifecycle

- **`sessionId` is required on every per-session tool.** There is no shared default. Two MCP clients (or two Claude Code sessions sharing one server) cannot accidentally talk to the same shell.
- **Calls are serialized per session, not globally.** Two calls against the same terminal run in order; a long `terminal_wait` on one session does not hold up another.
- **Sessions go to the tombstone for system-driven termination, not for `terminal_destroy`.** If the shell exits, the session sits idle for over 6 hours, or the 50-session cap forces an LRU eviction, the sessionId is *retained as a tombstone for 30 days*. Calling against a tombstoned id auto-respawns a fresh shell under the same id — same size, shell, working directory, scrollback and theme the session had — and returns a notice quoting the original termination reason. If the shell exited on its own, the notice includes the last screen it printed, which is usually the only clue to why.
- **"Idle" means no tool calls *and* no output.** A dev server or long build that is still printing is not idle and won't be killed at the 6-hour mark; a shell sitting at its prompt is.
- **The server cleans up after itself.** When the MCP client disconnects (stdin closes) or the process gets SIGINT/SIGTERM/SIGHUP, every shell is killed and every attach socket removed.
- **`terminal_destroy` is a hard delete.** No tombstone — future calls against the id error with "Unknown sessionId."

## Install

You need Node ≥ 20.19 on macOS or Linux, and access to the [`computer-agent-labs/terminal-use`](https://github.com/computer-agent-labs/terminal-use) repo. Install globally from git in one shot:

```bash
npm install -g --install-links=true git+ssh://git@github.com/computer-agent-labs/terminal-use.git
```

That clones the repo, installs native dependencies (prebuilt binaries for macOS/Linux × arm/x64 — no toolchain required), and drops a `terminal-use` binary on your PATH. There is no separate build step: the bin shim registers [`tsx`](https://github.com/privatenumber/tsx) on startup and runs the TypeScript sources directly. Startup cost is around 50 ms per process.

(The `--install-links=true` flag forces npm to hard-copy the package into the global install location. Without it, npm symlinks into its cache, which gets cleaned up later and breaks the bin.)

Then register with Claude Code:

```bash
claude mcp add terminal-use --scope user -- terminal-use
```

Verify:

```bash
claude mcp list
```

You should see `terminal-use` listed. Start a fresh Claude Code session and your agent will have `terminal_create`, `terminal_type`, `terminal_screenshot`, `terminal_click`, etc.

To update, re-run the same install command — npm replaces the global install with the latest from `main`.

To uninstall: `npm uninstall -g terminal-use` and `claude mcp remove terminal-use`.

**Windows is untested.** The native dependencies ship Windows binaries and the attach transport switches to a named pipe there, but nothing has been run on Windows; `terminal_wait` in particular falls back to its output-quiet heuristic.

### Local development install

Working on the code itself (cloned the repo directly)?

```bash
yarn install
claude mcp add terminal-use --scope user -- node "$PWD/bin/terminal-use.js"
```

No build step needed — the bin shim checks the Node version, picks up tsx from `node_modules` and runs sources in-place. `yarn build` is still available for typecheck-then-emit if you want it, but nothing runs from `build/`.

## Develop

```bash
yarn dev               # run server with tsx, no build
yarn start             # run server through the bin shim, as an install would
yarn typecheck         # tsc --noEmit
yarn lint              # eslint
yarn test              # full vitest suite
yarn test:unit         # unit tests only
yarn smoke             # hand-runnable end-to-end (no MCP client)
```

## License

[MIT](LICENSE). The bundled JetBrains Mono fonts are under the SIL Open Font License (`fonts/OFL.txt`).
