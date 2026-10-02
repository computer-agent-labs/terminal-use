# Troubleshooting

## The response says a fresh shell was spawned

The shell behind a shell session ended between your calls. The notice says why:

- **shell exited**: something ran `exit`, or the shell crashed. The notice includes the last screen it printed.
- **terminated due to inactivity**: no calls and no output for six hours.
- **evicted**: more than 50 sessions were open and this was the least recently used.

In every case the input you sent with that call was dropped, and the new shell has none of the old state. Re-create what you need (directory, environment, running programs), then send the input again. The session keeps its id, size, shell and working directory.

## "Unknown sessionId"

The session was destroyed, or it was a command session that was closed for inactivity. Call `terminal_list` to see what exists, or `terminal_create` to start again.

## A command session reports that its command exited

That is the normal end of a command session, not an error. `terminal_read` and `terminal_screenshot` still show its final screen. `terminal_reset` with `hardReset: true` runs the same command again; `terminal_destroy` removes the session.

## "Buffer was still active"

The program was still printing when the input tool's wait ran out. Nothing is wrong. Call `terminal_wait` to wait for it to finish, or `terminal_read` to see where it has got to.

## terminal_wait returns at once, but the program is still working

The default wait asks whether the shell has the terminal back. Two cases fool it:

- **Background jobs** (`cmd &`): the shell gets the terminal back immediately. Wait with a `pattern` for the job's output instead.
- **You are inside another program** (ssh, a REPL, a container shell, tmux): the *outer* shell is what terminal-use watches, and it will not be back until that program exits. Use a `pattern` for the inner prompt, or `until: "quiet"`.

## terminal_wait times out, but the command looks finished

Something is still holding the terminal: a pager waiting for `q`, a prompt waiting for an answer, a program waiting for input. Read the screen.

## A pattern matches immediately

It matched text that was already on screen - often your own typed command, which contains the words you are waiting for. Make the pattern specific to the output (anchor it with `^`, or match something the command line does not contain).

## Keys do nothing, or print odd characters like `^[[A`

- The program in front is not the one you think. Read the screen.
- You sent a key to a program that is reading plain lines (`cat`, a simple prompt); arrow keys mean nothing to it and are echoed as escape codes.
- A plain letter was sent with `terminal_press`. Letters go through `terminal_type`.

## A click is refused

The program has not turned on mouse support, so it could not receive the click. Use the keyboard. At a shell prompt there is nothing to click.

## Tools are "command not found" inside the session

The server was started without the user's usual `PATH`, which happens when the MCP client is launched from a desktop icon rather than a terminal. Create the session with `login: true` so the shell reads the user's profile files.

## Characters show as empty boxes in a screenshot

The font for those characters (emoji, Chinese, Japanese, Korean, Nerd Font icons) is not installed on the machine. This affects the picture only. `terminal_read` returns the real characters.

## Long lines look broken across rows

They should not: reads join lines the terminal wrapped. If you need one line per screen row (to line text up with click coordinates), pass `joinWrapped: false`.

## The session is at the wrong size for the program

Call `terminal_resize`. The program is told about the new size and redraws; read the screen again afterwards.
