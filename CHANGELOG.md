# Changelog

## 1.0.0 (2026-10-21)

First public release.

- Cards for Claude's requests in a Handoffs pane: steps, decision buttons, and Open and Copy buttons.
- A Waiting on you band above the prompt while any card is open.
- Send to Claude and Mark done send your ticks and your pick back; unsent clicks go along with your next message.
- Cards kept per session for 14 days, and restored after a compaction or a resume.
- One card per topic: your messages carry the open cards, so Claude updates a topic's card instead of adding a duplicate, and closes cards a new one replaces.
- Open never runs a program: code opens in a text editor, and apps, installers and links are shown in their folder.
- Works on Mac, Linux and Windows: in WSL, in the CLI in PowerShell, and in Claude Desktop. On Windows, code and other text open with the file type's Edit action, or in Notepad when it has none.
- Run lines are written for the shell you paste them into: PowerShell on Windows, your distro's shell under WSL.
- Follows your theme, light or dark, with Ghost Hat accents for each. It redraws when you change the theme, and under Auto when your system switches.
- Outside fullscreen mode, the pane and `/handoffs` say how to give the pane its own column: `/tui fullscreen`.
- Spacing sized for Claude Desktop as well as the terminal, and the GH monogram at the top of the pane in Claude Desktop and the phone app.
