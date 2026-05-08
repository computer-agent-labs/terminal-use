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

### Per-session (act on a terminal)

| Tool | Purpose |
|---|---|
| `terminal_type` | Type literal characters; `\n` is normalized to Enter. |
| `terminal_press` | Press named keys/combos (`Enter`, `Ctrl+C`, `ArrowUp`, `Shift+Tab`, `F1`...). |
| `terminal_resize` | Change cols/rows; either is optional (preserves current). |
| `terminal_reset` | Wipe buffer; `hardReset: true` kills + respawns the shell. |
| `terminal_read` | Read the buffer, paginated in screen-sized windows. Cursor marked inline by default. |
| `terminal_screenshot` | PNG of the current screen (or any earlier screen-sized window via `page`). |

Each accepts an optional `sessionId` to target a specific session; omit it to target the current default (auto-created on first use, so single-session agents never have to think about it).

### Session management

| Tool | Purpose |
|---|---|
| `terminal_create` | Spawn a new terminal session and return its numeric id; optional `label` for terminal_list display. |
| `terminal_list` | List every active session; the current default is starred. Dead-shell sessions show their exit info. |
| `terminal_select` | Set which session is the current default for tools that omit `sessionId`. |
| `terminal_destroy` | Kill a session and remove it. |

When a session's shell exits between tool calls (e.g. the agent typed `exit`), the next tool call against that session auto-respawns it under the same `sessionId` and returns a notice with the exit code/signal.

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
