# Key reference for terminal_press

`terminal_press` takes one key spec: an optional list of modifiers joined with `+`, then a key name. Names are not case sensitive. `count` repeats the key.

## Named keys

| Key | Spec |
|---|---|
| Enter | `Enter` (or `Return`) |
| Escape | `Escape` (or `Esc`) |
| Tab / back-tab | `Tab`, `Shift+Tab` |
| Backspace | `Backspace` |
| Space | `Space` |
| Arrows | `ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight` (or `Up`, `Down`, `Left`, `Right`) |
| Navigation | `Home`, `End`, `PageUp`, `PageDown`, `Insert`, `Delete` |
| Function keys | `F1` to `F12` |

## Modifiers

`Ctrl`, `Alt` (or `Option`), `Shift`, `Meta` (or `Cmd`, `Super`).

| Combination | Examples | Notes |
|---|---|---|
| Ctrl + letter | `Ctrl+C`, `Ctrl+D`, `Ctrl+Z`, `Ctrl+L`, `Ctrl+R` | Any letter A to Z |
| Ctrl + punctuation | `Ctrl+[` (Escape), `Ctrl+\`, `Ctrl+]`, `Ctrl+^`, `Ctrl+_`, `Ctrl+Space` | |
| Alt + letter | `Alt+B`, `Alt+F`, `Alt+Shift+B` | Word movement in most shells |
| Alt + punctuation or digit | `Alt+.`, `Alt+<`, `Alt+1` | |
| Alt + Enter | `Alt+Enter` | "New line without submitting" in many programs |
| Alt + Backspace | `Alt+Backspace` | Delete the previous word |
| Modified arrows and navigation | `Ctrl+ArrowLeft`, `Shift+ArrowUp`, `Ctrl+Shift+ArrowRight`, `Ctrl+PageUp` | |
| Modified function keys | `Shift+F1`, `Ctrl+F5` | |

## What does not exist

- **Plain letters, digits and punctuation** are not keys here. Send them with `terminal_type`: to press `q` in a pager, type `"q"`.
- **`Shift+Enter` and `Ctrl+Enter`** cannot be expressed to a terminal program. Use `Alt+Enter`.
- **`Ctrl+Tab`, `Ctrl+Shift+letter`, and Cmd shortcuts** belong to the window system and never reach a terminal program.

## Common jobs

| To do this | Send |
|---|---|
| Interrupt the running program | `Ctrl+C` |
| End input / exit a shell or REPL | `Ctrl+D` |
| Suspend to the background | `Ctrl+Z`, then `fg` to return |
| Clear the screen | `Ctrl+L` |
| Search shell history | `Ctrl+R`, then type |
| Previous command | `ArrowUp` |
| Complete a word | `Tab` |
| Leave insert mode in vim | `Escape` |
| Move down five rows | `ArrowDown` with `count: 5` |
