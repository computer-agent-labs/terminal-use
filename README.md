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

## Tools

### Per-session (act on a specific terminal)

Each of these requires `sessionId`. Get one by calling `terminal_create`.

| Tool | Purpose |
|---|---|
| `terminal_type` | Type literal characters; `\n` is normalized to Enter. |
| `terminal_press` | Press named keys/combos (`Enter`, `Ctrl+C`, `ArrowUp`, `Shift+Tab`, `F1`…). |
| `terminal_resize` | Change cols/rows; either is optional (preserves current). |
| `terminal_reset` | Wipe buffer; `hardReset: true` kills + respawns the shell. |
| `terminal_read` | Read the buffer, paginated in screen-sized windows. Cursor marked inline by default. |
| `terminal_screenshot` | PNG of the current screen (or any earlier screen-sized window via `page`). |
| `terminal_click` | Left-click at a (col, row) cell. See *Click semantics* below. |

### Session management

| Tool | Purpose |
|---|---|
| `terminal_create` | Spawn a new session and return its numeric id; optional `label` for `terminal_list` display. |
| `terminal_list` | List live sessions and tombstoned ids. |
| `terminal_destroy` | Kill a session and forget the id entirely. |

### Renderer glyph coverage

`terminal_screenshot` and `terminal_click`'s preview PNG use **JetBrains Mono Regular + Bold** as the bundled fonts. That covers Latin, Greek, Cyrillic, ANSI box-drawing (`┌─┬─┐` etc.), and most general-purpose symbols.

**Emoji** are also covered on **macOS** — the renderer falls back to `/System/Library/Fonts/Apple Color Emoji.ttc` when JetBrains Mono lacks a glyph, so 🎉🚀✨🐢 render in full color. Linux/Docker doesn't have Apple's font and we don't bundle Noto Color Emoji (~10MB), so emoji cells render as tofu boxes there.

**CJK** (`你好`) and **Nerd Font / Powerline icons** that live in the supplementary Private Use Area render as tofu on every platform — we don't bundle Noto Sans CJK (~7MB per region) either.

The text path (`terminal_read`) is unaffected — it returns the exact codepoints from xterm-headless's buffer, faithfully including everything. So when working with content that has tofu'd glyphs in the PNG, prefer `terminal_read` for ground truth and use the screenshot to spot-check layout / colors / ANSI styling.

### Click semantics

- **Left-button only**, no modifiers, no right/middle/wheel (v1 scope).
- **Coordinates are 1-indexed**: `(col 1, row 1)` is the top-left cell of the live viewport, `(term.cols, term.rows)` is the bottom-right.
- **`preview` defaults to `true`.** A preview call renders a PNG with a bright magenta ring + dark halo + center dot drawn at the target cell, plus a `(col N, row M)` coordinate label off to the side. *No click is sent.* The agent inspects the preview and then, if the target is right, repeats with `preview: false`.
- **Execute mode requires the foreground program to have enabled mouse tracking.** Vim with `set mouse=a`, fzf, lazygit, less with `--mouse`, and most modern TUIs auto-enable it on startup. At a plain shell prompt, mouse mode is off and an execute call returns `isError: true` with an explanatory message rather than printing junk escape sequences as text.
- **Wire-level encoding is SGR** (`CSI <0;col;row M` press, `m` release). Press + release are sent atomically.
- **Known cosmetic limit**: when the target is in the rightmost ~10 columns, the coordinate label drawn next to the ring may clip off the canvas. The ring itself is always in frame, so trust it over the label.
- **`idleMs` / `maxWaitMs` are accepted but ignored in preview mode** (preview never settles).

### Attach (tmux-style human attach)

You can attach to any live session from your own terminal and watch / type alongside the agent.

`terminal_create` prints the attach command in its response — the agent can quote it back to you:

```
Attach (read/write, tmux-style): node /abs/path/terminal-use/build/src/bin/terminal-use.js attach 3
```

What it does:

- Connects to a per-session Unix domain socket at `/tmp/terminal-use-<server-pid>-<sessionId>.sock` (mode 0600 — same Unix user only).
- The PTY's output is broadcast to every attached client *and* the xterm-headless buffer the agent reads from. The agent and any attached humans are peers on the same PTY.
- Multiple concurrent attaches are allowed (tmux-style). All clients see the same output; any client's typing reaches the shell.
- Press **Ctrl+]** to detach.
- Pass `--resize` to make the human's terminal size override the session's (and SIGWINCH-resize the session as the human resizes their window). Default is to leave the session size alone.
- The socket survives across shell-exit / idle-kill / eviction — your connection stays open and you'll see new output as soon as the next tool call against this id triggers a respawn. The socket only goes away on `terminal_destroy` or after the 30-day tombstone retention expires.

### Lifecycle

- **`sessionId` is required on every per-session tool.** There is no shared default. Two MCP clients (or two Claude Code sessions sharing one server) cannot accidentally talk to the same shell.
- **Sessions go to the tombstone for system-driven termination, not for `terminal_destroy`.** If the shell exits, the session sits idle for over 6 hours, or the 50-session cap forces an LRU eviction, the sessionId is *retained as a tombstone for 30 days*. Calling against a tombstoned id auto-respawns a fresh shell under the same id and returns a notice quoting the original termination reason.
- **`terminal_destroy` is a hard delete.** No tombstone — future calls against the id error with "Unknown sessionId."

## Install

```bash
yarn install
yarn build
```

Then register with your MCP client:

```bash
claude mcp add terminal-use -- node /absolute/path/to/terminal-use/build/src/bin/terminal-use.js
```

## Develop

```bash
yarn dev               # run server with tsx, no build
yarn test              # full vitest suite
yarn test:unit         # unit tests only
yarn smoke             # hand-runnable end-to-end (no MCP client)
```
