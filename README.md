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

| Tool | Purpose |
|---|---|
| `terminal_type` | Type literal characters; `\n` is normalized to Enter. |
| `terminal_press` | Press named keys/combos (`Enter`, `Ctrl+C`, `ArrowUp`, `Shift+Tab`, `F1`...). |
| `terminal_resize` | Change cols/rows; either is optional (preserves current). |
| `terminal_reset` | Wipe buffer; `hardReset: true` kills + respawns the shell. |
| `terminal_read` | Read the buffer, paginated in screen-sized windows. |
| `terminal_screenshot` | PNG of the current screen (or any earlier screen-sized window via `page`). |

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
