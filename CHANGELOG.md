# Changelog

## 1.2.5 (2026-11-24)

- Fixed: the Done list showed finished cards oldest first, all at once, and the pane doesn't scroll, so the most recent ones could sit out of reach below the bottom. It now shows the most recent first, ten at a time, with a Show more button for the rest.

## 1.2.4 (2026-11-24)

- Picking an option now always reaches Claude at once. On a card with steps, a pick used to wait for a separate Send press, so it could look as if nothing happened. Your ticks go along with it; the card closes once every step is ticked, and otherwise stays open showing your pick.
- Answering in the chat now updates the card. When your message is exactly one of an open card's choices, typed or pressed in the box under Claude's reply, Handoffs records that pick on the card and closes it (or keeps it open showing the pick while steps are unticked). A message that only mentions a choice changes nothing.

## 1.2.3 (2026-11-18)

- Fixed: after `/clear`, Claude could stop writing cards where another plugin skips the way Handoffs teaches it the format (Claude Code's own `sec-default`, on Team and Enterprise plans and machines with managed settings). A `/clear` starts a new conversation without a new session start, so Handoffs kept believing the format had already gone, and only the one-line reminder went with each message. Now the next message after a `/clear` carries the whole format again.

## 1.2.2 (2026-11-17)

- Fixed: in long sessions, every choice on a card could end up in one button, such as "Keep it, delete it, or ask first". Claude Code shortens old messages as a session grows. Where Handoffs teaches Claude the card format with your messages instead of its system prompt (when another plugin skips that step), only a short reminder was left after the shortening, and it didn't say to separate choices with a bar. It does now, so each choice gets its own button however long the session runs.

## 1.2.1 (2026-11-03)

- Run lines are back to how 1.1.3 had them. A command with `cd` or `export` is shown and copied inside `( … )`, so it runs the same whether you paste it into your own terminal or after `!` in Claude's prompt, and a `cd` can't move Claude's shell for the rest of the session. In 1.2.0 the brackets were dropped, which broke the `!` case.
- Removed: the Run in Claude button from 1.2.0. A `!` the mod puts in your prompt doesn't switch on Claude Code's shell mode, so it never ran anything. And run lines are for commands you need to run yourself, so Copy is the right button for them.
- When Claude runs a card's command itself, it now runs it inside `( … )`, so a `cd` in the command can't move its working folder.

## 1.2.0 (2026-11-03)

- Copy now takes a command exactly as Claude wrote it, for pasting into your own terminal. A command with `cd` or `export` used to be wrapped in `( … )`, which most people deleted before running it.
- A new Run in Claude button puts the command in your prompt after a `!`, so Claude Code runs it in its own shell. There it goes inside `( … )`, so a `cd` doesn't move Claude's working folder for the rest of the session and the whole line runs as one command. A draft you're typing is never replaced. Not shown on Windows, where run lines are written for PowerShell.
- Each card has a Copy as Markdown button. It copies the whole card, with its steps as a checklist, ready to paste into a pull request, an issue or a doc.
- A resumed session with cards still waiting opens the pane, as a new card does.
- When the pane can't open on its own (in a narrow window, for example), `/handoffs` says why.

## 1.1.3 (2026-10-29)

- When Claude asks you something in its own question box (the one with Skip and Next), the band above the prompt and the pane now say Claude is waiting on you, until you answer.

## 1.1.2 (2026-10-29)

- Fixed: in Claude Desktop, VS Code and the mobile app, the pane now follows the app’s own light or dark mode. In light mode it used to keep a dark background behind dark text, which made cards hard to read.

## 1.1.1 (2026-10-28)

- Fixed: on a Mac, Open on a link could fail for a whole session with "Could not open", because Handoffs mistook the Mac for Linux after one failed check. It now checks again instead of keeping the wrong answer.
- When Open can't open something, the message says why.

## 1.1.0 (2026-10-28)

- One **Send** button replaces Send to Claude and Mark done. It shows once you've ticked or picked something, and reads **Send and close** when everything's done.
- On a card that's just a choice, picking an option sends it straight away.
- **✕** closes a card. Claude hears it was closed, with anything you ticked, along with your next message.
- Tick everything on a card and your next message closes it, with no button to press. Claude can still close any card that's plainly finished.
- When your ticks reach Claude with a message, Claude says it got them.

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
