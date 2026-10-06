# Contributing to terminal-use

Thanks for taking the time. Bug reports, fixes, docs and new features are all welcome.

## Reporting a bug

Open an issue using the bug report form. The most useful reports include:

- what you asked the agent to do, and which tool call misbehaved (the tool name and its arguments, if you have them);
- what the tool returned, and what you expected;
- your OS, Node version (`node -v`), terminal-use version (`npx terminal-use --version`) and MCP client;
- the program running in the terminal, if it was a full-screen one (`vim`, `htop`, …).

Security problems go through private reporting instead; see [SECURITY.md](SECURITY.md).

## Suggesting a feature

Open an issue first and describe the problem you are trying to solve. For anything bigger than a small change, agreeing on the approach before writing code saves everyone time.

## Making a change

You need Node.js 20.19 or newer and [Yarn 1](https://classic.yarnpkg.com).

```bash
git clone https://github.com/computer-agent-labs/terminal-use.git
cd terminal-use
yarn install
yarn test
```

While working:

```bash
yarn dev          # run the MCP server from source
yarn lint:fix     # fix formatting and import order
yarn typecheck
yarn test         # builds dist/, then runs every test
yarn test:unit    # just the fast unit tests
yarn smoke        # quick end-to-end check without an MCP client
```

To try your change in a real client, point it at your checkout:

```bash
yarn build
claude mcp add terminal-use-dev --scope user -- node "$PWD/bin/terminal-use.js"
```

### Where things live

| Directory | What's in it |
|---|---|
| `src/pty` | Starting processes on a pseudo-terminal; encoding keys and mouse events |
| `src/emulator` | The terminal emulator buffer, waiting for output, highlights, rendering screenshots |
| `src/session` | One terminal session |
| `src/attach` | The socket a human attaches through, and the `attach` command |
| `src/mcp` | The MCP tools, session bookkeeping, and the skills extension |
| `skills/terminal-use` | The agent skill shipped with the package |
| `tests/unit`, `tests/integration`, `tests/mcp` | Tests, from smallest to end-to-end through an MCP client |

### What a good pull request looks like

- **One change per pull request**, with a description of what it fixes or adds and why.
- **Tests for the behavior you changed.** Most behavior is best tested end to end in `tests/mcp/`, driving a real shell through the MCP client the way an agent would.
- **Tests that pass on macOS and Linux.** CI runs both. `/bin/sh` is bash on macOS but dash on Debian and Ubuntu, which has no line editing; a test that moves the cursor within a command line should create its session with `EDITING_SHELL` from `tests/mcp/helpers.ts`.
- **Docs updated** when you change what a tool does: its description in `src/mcp/tools/`, the README, and the skill in `skills/terminal-use` if it mentions the behavior.
- **Code that matches its surroundings.** ESLint enforces the style (no semicolons, single quotes, two-space indentation, ordered imports); `yarn lint:fix` handles most of it.
- **Commit messages** with a short imperative subject line, such as `Fix cursor position after wide characters`.

Tool descriptions are read by models, not just people. Write them as instructions to an agent: when to use the tool, what it returns, and what to do next.

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By taking part, you agree to uphold it.
