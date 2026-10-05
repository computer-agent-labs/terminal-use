# Security

## What terminal-use can do

terminal-use gives the connected MCP client a shell on your machine, running as you. That is the whole point of it, so there is no sandbox: anything you can do in a terminal, an agent using these tools can do. Only connect it to clients and models you would trust with a terminal, and rely on your client's tool-approval settings to decide what runs without asking.

Two things terminal-use does take care of:

- **Attach sockets** let another terminal join a session. They are Unix domain sockets with mode `0600`, inside a per-user directory with mode `0700`, so only your own user can connect.
- **No network listener.** The server speaks MCP over stdio and opens no ports.

## Reporting a vulnerability

Please report security problems privately through GitHub: on the repository page, open **Security → Report a vulnerability**. Do not open a public issue for something exploitable.

Useful reports include what you did, what happened, and what you expected. You should get a reply within a few days.

Things that count: another local user being able to reach a session, the server being made to act without a tool call from its client, escape sequences in terminal output causing actions outside the session.

Things that don't: an agent running a harmful command through `terminal_type`. That is the tool working as designed, and is controlled by your MCP client's permissions.
