# Changelog

## 1.0.4 (2026-10-24)

- Handoffs now works where Claude Code's built-in security plugin (`sec-default`, on Team and Enterprise plans and machines with managed settings) skips third-party plugins' prompt hooks. Before, Claude never got the handoff format there. Now it goes with your next message, and with your first message in every session after that, plus a one-line reminder with each message after it.
- Claude is told plainly that a reply ending with "want me to go ahead?" is waiting on you and needs a card.

## 1.0.3 (2026-10-23)

- The pane shows a one-time tip on turning on auto-update, so new versions arrive without you asking. Got it puts it away.
- After an update, the pane and `/handoffs` say what changed, once, with a link to this changelog.

## 1.0.2 (2026-10-23)

- If Claude never gets the handoff format in a session, the pane says so and points to Troubleshooting, instead of quietly showing "Nothing waiting on you".
- On a Claude Code older than 2.1.299, the pane and a notice at startup say to run `claude update`.
- `/handoffs` says how Claude got the format: in its instructions, or with your first message.
- If writing the format into Claude's instructions fails, it goes with your first message instead.
- The README says how to turn on auto-update, so new versions arrive on their own.

## 1.0.1 (2026-10-23)

- Claude now learns the handoff format in sessions that start with their own system prompt, such as `--system-prompt`, a custom agent, or an app built on the Agent SDK. Before, the pane appeared but Claude never wrote cards. In those sessions the format goes along with your first message instead.

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
