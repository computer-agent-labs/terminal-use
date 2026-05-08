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

### Session management

| Tool | Purpose |
|---|---|
| `terminal_create` | Spawn a new session and return its numeric id; optional `label` for `terminal_list` display. |
| `terminal_list` | List live sessions and tombstoned ids. |
| `terminal_destroy` | Kill a session and forget the id entirely. |

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
