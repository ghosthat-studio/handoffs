import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine, Register, RenderSurface } from 'claude-code'

import type { Handoff, Link, Step } from '../types'
import { MONOGRAM } from './monogram.ts'

const PANE = 'handoffs'
const TITLE = 'Handoffs'
const SELF = 'handoffs'

const items = atom({ plugin: 'handoffs', key: 'items' } as const, [])
const seq = atom({ plugin: 'handoffs', key: 'seq' } as const, 1)
const showDone = atom({ plugin: 'handoffs', key: 'showDone' } as const, false)
const seen = atom({ plugin: 'handoffs', key: 'seen' } as const, [])

// Cards are saved per session in the store, so a resumed session gets its cards back; a new session starts empty.
const SAVED = 'sessions'
const KEEP_MS = 14 * 24 * 60 * 60_000
type Saved = Record<string, { items: Handoff[]; seq: number; at: number }>

// Text and backgrounds follow the person's theme: the pane paints no background of its own, and body text is in
// the theme's own colours, so it reads on every surface and theme. The Ghost Hat accents come in a dark and a light
// set, each 7:1 or more on its ground where they colour text; the outlines keep the brand Violet.
type Mode = 'dark' | 'light'
const INK = 'text'
const DIM_INK = 'inactive'
const ACCENTS = {
  // The heading violet, a lighter tint of the brand Violet (#8F82D8, which is under 7:1 for text).
  // In dark, the pane keeps the brand's near-black and its cards gunmetal; in light it takes the theme's own ground.
  dark: { heading: '#B3A8F0', outline: '#8F82D8', steel: '#98ABC1', brass: '#D4C5A4', ground: '#0A0B0E', card: '#0D0F12' },
  light: { heading: '#463A9A', outline: '#463A9A', steel: '#3A4A5E', brass: '#664510', ground: undefined, card: undefined },
}
// Desktop, VS Code and mobile draw in their own light or dark, which the theme setting doesn't name and the mod can't
// read. There the pane paints no ground and colours its text with theme keys, which those apps resolve to their own
// mode; only the outline is fixed, in the brand Violet, which reads on both.
const IN_APP = { heading: INK, outline: '#8F82D8', steel: DIM_INK, brass: INK, ground: undefined, card: undefined }
// Outside fullscreen the terminal gives the pane no column of its own. The mod can't change that setting itself, so
// it says how.
const FULLSCREEN_HINT = 'The pane sits beside the conversation in fullscreen mode. Type /tui fullscreen to turn it on.'

// The theme setting names light or dark, or auto, which follows the system. Under auto, the system's own setting is
// read once and then watched (see session.start), so the pane switches when the system does, not at its next redraw.
let appearance: Mode | undefined

// While Claude waits on its own question dialog (the AskUserQuestion tool), the band and pane say so. The dialog
// holds the question itself; Handoffs only points to it, since that's a request it never sees as a block.
type Asking = { first: string; count: number }
let asking: Asking | undefined
const askedOf = (questions: unknown): Asking | undefined => {
  const list = Array.isArray(questions) ? questions : []
  const head = list[0] as { question?: unknown } | undefined
  return list.length === 0 ? undefined : { first: typeof head?.question === 'string' ? head.question : '', count: list.length }
}
async function themeOf($: Engine) {
  return (await $.config.list().catch(() => [])).find(row => row.key === 'theme')?.value
}
async function systemMode($: Engine): Promise<Mode> {
  const os = await where($)
  const argv = os === 'mac' ? ['defaults', 'read', '-g', 'AppleInterfaceStyle']
    : os === 'linux' ? ['gsettings', 'get', 'org.gnome.desktop.interface', 'color-scheme']
    : ['reg.exe', 'query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize', '/v', 'AppsUseLightTheme']
  const out = (await $.process.run(argv).catch(() => undefined))?.stdout ?? ''
  // macOS names Dark only when dark is on. GNOME says prefer-light or prefer-dark, and Windows holds 1 or 0 for light
  // apps; anywhere the setting can't be read, the pane stays dark.
  return os === 'mac' ? (/Dark/.test(out) ? 'dark' : 'light')
    : os === 'linux' ? (/light/.test(out) ? 'light' : 'dark')
    : /0x1\b/.test(out) ? 'light' : 'dark'
}
async function modeOf($: Engine): Promise<Mode> {
  const theme = await themeOf($)
  if (typeof theme === 'string' && theme.startsWith('light')) return 'light'
  if (theme !== 'auto') return 'dark'
  return (appearance ??= await systemMode($))
}

// The format Claude is asked to write; the system prompt section below teaches it.
const FENCE = /```handoff[^\n]*\n([\s\S]*?)```/g

const FORMAT = `# Handoffs

When your reply ends waiting on the person to do or decide something, end it with a handoff block. The Handoffs pane turns it into a card with checkboxes, decision buttons and Open buttons for files, and a band above the prompt shows it is waiting. Write it as a fenced code block whose language is \`handoff\`, one field per line:

\`\`\`handoff
title: A short name for the request
need: What you need from them, in one sentence.
why: Why you need it, in one sentence.
step: One thing to do (one line per step, in order)
decide: First option | Second option | Third option
review: path/to/a/file/to/look/at
link: Pull request 22 | https://github.com/owner/repo/pull/22
run: cd /absolute/path/to/project && npm run deploy
\`\`\`

Only \`need\` is required. Use \`decide\` when there is a choice: each option becomes a button. Use one \`review\` line per local file they should open, absolute or relative to the working directory. Use one \`link\` line per web page (a label, a bar, then the URL), each of which becomes an Open button; a URL written anywhere else on the card gets an Open button too. Use one \`run\` line per shell command they need to run themselves; each gets a Copy button. Write each command so it runs from any folder: use absolute paths, and \`cd\` with an absolute path when it must run somewhere in particular. Do not put links or commands inside \`step\` text when a \`link\` or \`run\` line will do. Write one block per request. Keep the reply's own prose as usual; the block is shown in the transcript as a one-line pointer to its card, so do not leave anything in it that the prose needs.

Cards are numbered h1, h2, ... When the person sends a card back you get a message headed \`Handoff h2 (title)\` with the steps they ticked and the option they picked. To change a card that is still open, write the whole card again with its \`id: h2\`: the new block replaces the card, so leave out a line to remove it. Steps whose text you keep stay ticked; write \`step: [x] text\` to tick one yourself. To close a card that no longer stands, write a block holding only \`close: h2\`.

Keep one card per topic. Your context lists the cards still open; check that list before you write a block. When a request belongs to a topic that already has an open card, rewrite that card with its id rather than starting a new one, folding in what changed and dropping steps that no longer apply. When a new card takes over from older ones, or the plan has moved on, close the cards it replaces in the same reply. Requests on separate topics get separate cards, and two cards never share a step.

A reply that ends by asking whether to go ahead, or which way to go, is waiting on the person: end it with a card. Do not use a handoff block for anything you can do yourself, or for an aside that needs no answer.`

// The format's gist, with each later message when the format itself went with a message: it keeps its weight
// there, and it outlasts a compaction that drops the message the format came with.
const REMINDER = 'Handoffs: when your reply ends waiting on the person to do or decide something, including asking whether to go ahead, end it with a `handoff` block (title, need, why, step, decide, review, link and run lines; `id: h2` to rewrite an open card, `close: h2` to close one).'

type Parsed = {
  id?: string
  title?: string
  need: string
  why: string
  steps: Step[]
  options: string[]
  reviews: string[]
  links: Link[]
  runs: string[]
  close: string[]
}

const URL_IN_TEXT = /https?:\/\/[^\s<>()`'"]+[^\s<>()`'".,;:!?]/g
const isUrl = (value: string) => /^https?:\/\/\S+$/.test(value)

// `[x] text` or `[ ] text` at the start of a step.
const stepFrom = (value: string): Step => {
  const box = value.match(/^\[([ xX]?)\]\s*(.+)$/)

  return box?.[2] !== undefined ? { text: box[2].trim(), isDone: (box[1] ?? '').trim() !== '' } : { text: value, isDone: false }
}

const linkFrom = (value: string): Link | undefined => {
  const bar = value.lastIndexOf('|')
  const url = (bar < 0 ? value : value.slice(bar + 1)).trim().replace(/^<|>$/g, '')
  if (!isUrl(url)) return undefined
  const label = bar < 0 ? '' : value.slice(0, bar).trim()

  return { label: label === '' ? url.replace(/^https?:\/\/(www\.)?/, '') : label, url }
}

const addLink = (list: Link[], link: Link | undefined) => {
  if (link !== undefined && !list.some(l => l.url === link.url)) list.push(link)
}

function parseBlock(body: string): Parsed {
  const out: Parsed = { need: '', why: '', steps: [], options: [], reviews: [], links: [], runs: [], close: [] }
  for (const raw of body.split('\n')) {
    const line = raw.trim()
    if (line === '') continue
    const box = line.match(/^[-*]\s*(\[[ xX]?\].+)$/)
    if (box?.[1] !== undefined) {
      out.steps.push(stepFrom(box[1].trim()))
      continue
    }
    const m = line.match(/^([a-zA-Z]+)\s*:\s*(.*)$/)
    if (m === null) continue
    const key = (m[1] ?? '').toLowerCase()
    const value = (m[2] ?? '').trim()
    if (key === 'id') out.id = value
    else if (key === 'title') out.title = value
    else if (key === 'need' || key === 'needed') out.need = out.need === '' ? value : `${out.need} ${value}`
    else if (key === 'why') out.why = out.why === '' ? value : `${out.why} ${value}`
    else if (key === 'step') out.steps.push(stepFrom(value))
    else if (key === 'decide' || key === 'decision' || key === 'options') {
      out.options.push(...value.split('|').map(o => o.trim()).filter(o => o !== ''))
    } else if (key === 'review') {
      const path = value.replace(/^`|`$/g, '')
      if (isUrl(path)) addLink(out.links, linkFrom(path))
      else out.reviews.push(path)
    } else if (key === 'link' || key === 'url') addLink(out.links, linkFrom(value))
    else if (key === 'run' || key === 'command' || key === 'cmd') {
      const command = value.replace(/^`|`$/g, '').replace(/^\$\s+/, '').replace(/^!\s*/, '')
      if (command !== '') out.runs.push(command)
    } else if (key === 'close' || key === 'done') out.close.push(...value.split(/[\s,]+/).filter(Boolean))
  }
  // A URL written inside the card's text gets an Open button too.
  for (const text of [out.need, out.why, ...out.steps.map(st => st.text)]) {
    for (const url of text.match(URL_IN_TEXT) ?? []) addLink(out.links, { label: url.replace(/^https?:\/\/(www\.)?/, ''), url })
  }

  return out
}

export function parseAnswer(text: string): Parsed[] {
  return [...text.matchAll(FENCE)].map(m => parseBlock(m[1] ?? ''))
}

const titleFrom = (p: Parsed) => {
  if (p.title !== undefined && p.title !== '') return p.title
  const first = p.need.split(/(?<=[.?!])\s/)[0] ?? p.need

  return first.length > 60 ? `${first.slice(0, 57)}...` : first
}

const sameText = (a: string, b: string) => a.toLowerCase().replace(/\s+/g, ' ').trim() === b.toLowerCase().replace(/\s+/g, ' ').trim()

// Folds a reply's blocks into the cards: new requests, changes to open cards, closes.
export function apply(list: Handoff[], blocks: Parsed[], next: number, now: number, root: string) {
  let cards = [...list]
  let counter = next
  const added: Handoff[] = []
  for (const b of blocks) {
    if (b.close.length > 0 && b.need === '') {
      cards = cards.map(c => (b.close.includes(c.id) ? { ...c, status: 'done', isDirty: false } : c))
      continue
    }
    if (b.need === '' && b.steps.length === 0 && b.options.length === 0 && b.links.length === 0 && b.runs.length === 0) continue
    // A block without an id whose title matches an open card is that card again, not a second card on the topic.
    const same = b.id !== undefined
      ? cards.find(c => c.id === b.id)
      : b.title === undefined ? undefined : cards.find(c => c.status === 'open' && sameText(c.title, b.title ?? ''))
    if (same !== undefined) {
      // The block is the whole card again: what it leaves out is gone, but a step whose text it keeps stays ticked.
      const steps: Step[] = b.steps.map(st => ({
        text: st.text,
        isDone: st.isDone || same.steps.some(old => old.isDone && sameText(old.text, st.text)),
      }))
      const changed: Handoff = {
        ...same,
        title: b.title !== undefined || b.need !== '' ? titleFrom(b) : same.title,
        need: b.need || same.need,
        why: b.why,
        steps,
        options: b.options,
        pick: same.pick !== null && b.options.includes(same.pick) ? same.pick : null,
        reviews: b.reviews,
        links: b.links,
        runs: b.runs,
        status: 'open',
      }
      cards = cards.map(c => (c.id === same.id ? changed : c))
      continue
    }
    const id = b.id !== undefined && b.id !== '' && !cards.some(c => c.id === b.id) ? b.id : `h${counter++}`
    const card: Handoff = {
      id, title: titleFrom(b), need: b.need, why: b.why,
      steps: b.steps,
      options: b.options, pick: null, reviews: b.reviews, links: b.links, runs: b.runs, root,
      status: 'open', createdAt: now, isDirty: false,
    }
    cards.push(card)
    added.push(card)
  }

  return { cards, next: counter, added }
}

// What Claude is told about a card: its ticks and its pick.
export function report(card: Handoff, how: 'progress' | 'done' | 'closed' | 'open'): string {
  const head =
    how === 'done' ? `Handoff ${card.id} (${card.title}): marked done.`
      : how === 'closed' ? `Handoff ${card.id} (${card.title}): the person closed this card.`
      : how === 'open' ? `Handoff ${card.id} (${card.title}) is still open.`
        : `Handoff ${card.id} (${card.title}): progress so far.`
  const lines = [head]
  if (how === 'open' && card.need !== '') lines.push(`Needed: ${card.need}`)
  for (const s of card.steps) lines.push(`- [${s.isDone ? 'x' : ' '}] ${s.text}`)
  if (card.options.length > 0) {
    lines.push(card.pick === null ? `Decision: not made yet (${card.options.join(' / ')}).` : `Decision: ${card.pick}`)
  }
  if (how === 'open' && card.reviews.length > 0) lines.push(`To review: ${card.reviews.join(', ')}`)
  if (how === 'open') for (const l of card.links) lines.push(`Link: ${l.label} | ${l.url}`)
  if (how === 'open') for (const command of card.runs) lines.push(`Run: ${command}`)

  return lines.join('\n')
}

// The open cards as each of the person's messages carries them: enough to tell whether a request already has a card.
export function openList(open: Handoff[]): string {
  const cards = open.map(card => {
    const lines = [`${card.id}: ${card.title}`, `  Needed: ${card.need}`]
    for (const s of card.steps) lines.push(`  - [${s.isDone ? 'x' : ' '}] ${s.text}`)
    if (card.options.length > 0) lines.push(card.pick === null ? `  Decision: not made yet (${card.options.join(' / ')})` : `  Decision: ${card.pick}`)

    return lines.join('\n')
  })

  return `Handoff cards open in the Handoffs pane. Before writing a new handoff block, check these: a request on one of these topics rewrites that card with its id, and a card a new one replaces is closed.\n\n${cards.join('\n\n')}`
}

type Platform = 'mac' | 'linux' | 'wsl' | 'windows'
let platform: Platform | undefined

// WSL reports Linux, but its desktop is Windows, so Open and Copy go through the Windows side.
async function where($: Engine): Promise<Platform> {
  if (platform !== undefined) return platform
  if ((await $.env.get('OS').catch(() => undefined)) === 'Windows_NT') return (platform = 'windows')
  if ((await $.env.get('WSL_DISTRO_NAME').catch(() => undefined)) !== undefined) return (platform = 'wsl')
  // Not every WSL shell sets WSL_DISTRO_NAME (an SSH login doesn't), but its kernel is always named for Microsoft.
  // From / so a session folder that has gone away can't fail it.
  const ran = await $.process.run(['uname', '-sr'], { cwd: '/' }).catch(() => undefined)
  const name = ran?.exitCode === 0 ? ran.stdout.trim() : ''
  if (name.startsWith('Darwin')) return (platform = 'mac')
  if (/microsoft/i.test(name)) return (platform = 'wsl')
  if (name !== '') return (platform = 'linux')
  // uname failed: guess from the home folder for now, and ask again next time rather than keep the guess.
  const home = (await $.env.get('HOME').catch(() => undefined)) ?? ''
  return home.startsWith('/Users/') ? 'mac' : 'linux'
}

// Builds before 2.1.299 refuse a tree whose Text names a face; there the heavy faces fall back to bold.
let isRich = false

// How the format reached Claude: in the system prompt the engine composed, or, when it composed none, with the first
// message's context. A plugin seated over this one (Claude Code's own sec-default on managed, Team and Enterprise
// machines) can pass both prompt hooks over; then it goes with a message the person sends (`submit`): from the next
// one in the session that finds out, and from the first in every session after, since the store remembers.
let delivery: 'system' | 'message' | 'submit' | undefined
let isTurnDone = false

// Builds before this one lack the hooks the mod is built on.
const MIN_VERSION = [2, 1, 299]
let olderThanSupported: string | undefined

const README = 'https://github.com/ghosthat-studio/handoffs#troubleshooting'
const notices = () => [
  ...(olderThanSupported === undefined ? [] : [`Handoffs needs Claude Code ${MIN_VERSION.join('.')} or later, and this is ${olderThanSupported}. Run claude update in your terminal.`]),
  ...(delivery === undefined && isTurnDone ? [`Claude hasn't been given the handoff format yet: another plugin skipped the way Handoffs gives it. Claude gets it with your next message instead. See ${README}`] : []),
]
const deliveryNote = () =>
  delivery === 'system' ? 'Claude has the handoff format in its instructions.'
    : delivery === 'message' ? 'Claude got the handoff format with your first message.'
    : delivery === 'submit' ? 'Claude got the handoff format with one of your messages, and a reminder goes with each one after, because another plugin skips the way Handoffs usually gives it.'
    : isTurnDone ? '' : 'Claude gets the handoff format with your first message.'

// Told once, then put away with Got it: what changed when the mod updates, and how to get updates without asking.
const NOTES = 'notes'
// isSkipped: a session here ended a turn with the format never given, so the next ones send it with the first message.
type Notes = { version?: string; unread?: string; isTipDone?: boolean; isSkipped?: boolean }
const CHANGELOG = 'https://github.com/ghosthat-studio/handoffs/blob/main/CHANGELOG.md'
const TIP = 'Get new versions automatically: run /plugin, open Marketplaces, pick ghosthat-studio and choose Enable auto-update.'
const WHATS_NEW: Record<string, string> = {
  '1.1.3': 'When Claude asks you something in its own question box, the band and this pane now say so until you answer.',
  '1.1.2': 'In Claude Desktop, VS Code and the mobile app, the pane now follows the app’s light or dark mode.',
  '1.1.1': 'Open on a link works again on a Mac. If Open ever fails, the message now says why.',
  '1.1.0': 'Cards have one Send button, and ✕ to close one. A card that’s just a choice sends when you pick.',
  '1.0.4': 'Handoffs now works on Team and Enterprise machines, where Claude Code’s own security plugin skipped the way Handoffs teaches Claude the format. Claude is also told plainly that a reply asking whether to go ahead needs a card.',
  '1.0.3': 'Claude now writes cards in sessions that start with their own system prompt, and the pane tells you when Claude can’t make cards or Claude Code needs updating.',
}
let notes: Notes = {}

const ownVersion = async ($: Engine) => {
  const text = await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`).catch(() => undefined)
  try {
    const version = (JSON.parse(text ?? '{}') as { version?: unknown }).version
    return typeof version === 'string' ? version : undefined
  } catch {
    return undefined
  }
}

// A version this store has not seen is an update when an earlier one ran here: one the notes name, or, before
// there were notes, one that saved cards.
async function noteVersion($: Engine) {
  notes = ((await $.store.get(NOTES)) ?? {}) as Notes
  const version = await ownVersion($)
  if (version === undefined || version === notes.version) return
  const hasRun = notes.version !== undefined || Object.keys(((await $.store.get(SAVED)) ?? {}) as Saved).length > 0
  notes = { ...notes, version, unread: hasRun ? version : notes.unread }
  await $.store.set(NOTES, notes)
  if (hasRun) $.ui.toast(`Handoffs updated to ${version}. Type /handoffs to see what changed.`)
}

async function putAway($: Engine, change: Notes) {
  notes = { ...notes, ...change }
  await $.store.set(NOTES, notes)
  $.ui.invalidate('ui.render')
}

const formatText = async ($: Engine) => FORMAT + shellNote(await where($), await distroOf($))
type Face = { mono?: boolean; size?: 'caption' | 'footnote' | 'body' | 'heading' | 'title'; weight?: 'regular' | 'medium' | 'semibold' | 'bold' }
const face = (f: Face): Face | { bold?: boolean } =>
  isRich ? f : f.weight === 'semibold' || f.weight === 'bold' || f.size === 'title' || f.size === 'heading' ? { bold: true } : {}

const atLeast = (version: string, min: number[]) => {
  const parts = version.split(/[.-]/).slice(0, 3).map(Number)
  for (let i = 0; i < min.length; i++) {
    const a = parts[i] ?? 0
    const b = min[i] ?? 0
    if (a !== b) return a > b
  }

  return true
}

const isAbsolute = (path: string) => /^([A-Za-z]:[\\/]|[\\/])/.test(path)

async function openFile($: Engine, card: Handoff, path: string) {
  const os = await where($)
  const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? ''
  const full = isAbsolute(path) ? path : path.startsWith('~/') ? `${home}/${path.slice(2)}` : `${card.root}/${path}`
  if (!(await $.fs.exists(full))) {
    $.ui.toast(`${path} is not there.`)
    return
  }
  const info = await $.fs.stat(full).catch(() => undefined)
  const how = info === undefined ? 'show' : openHow(full, info.kind, info.isLink)
  const target = os === 'wsl' ? (await $.process.run(['wslpath', '-w', full]).catch(() => undefined))?.stdout.trim() : full
  if (target === undefined || target === '') {
    $.ui.toast(`Could not open ${path} here.`)
    return
  }
  const { argv, stdin } = openRun(os, how, target)
  let failure = ''
  const ran = await $.process.run(argv, stdin === undefined ? undefined : { stdin }).catch(error => {
    failure = String(error instanceof Error ? error.message : error)
    return undefined
  })
  // explorer.exe exits 1 even when it opened the file.
  const isOpened = ran !== undefined && (ran.exitCode === 0 || (ran.exitCode === 1 && (os === 'wsl' || os === 'windows')))
  if (!isOpened) $.ui.toast(`Could not open ${path} here${why(ran, failure)}`)
  else if (how === 'show') $.ui.toast(`Showed ${path} in its folder rather than opening it.`)
}

// Windows has no default text editor, and opening a script the usual way runs it. So text opens with the file
// type's Edit action, the editor an installer registered for it, and in Notepad when the type has none. That and
// Explorer's /select go through PowerShell's Start-Process, which returns at once: Notepad run directly would hold
// the click until it was closed. The path arrives on stdin, never in the command text, so nothing in a name is
// read as code; a Windows path holds no ".
const READ_PATH = `[Console]::InputEncoding = [Text.Encoding]::UTF8; $p = [Console]::In.ReadToEnd().Trim(); `
const EDIT = `${READ_PATH}try { Start-Process -FilePath $p -Verb Edit -ErrorAction Stop } catch { Start-Process notepad.exe -ArgumentList ('"' + $p + '"') }`
const SELECT = `${READ_PATH}Start-Process explorer.exe -ArgumentList ('/select,"' + $p + '"')`

export function openRun(os: Platform, how: 'open' | 'text' | 'show', full: string): { argv: string[]; stdin?: string } {
  if ((os !== 'windows' && os !== 'wsl') || how === 'open' || (os === 'wsl' && how === 'show')) return { argv: openArgv(os, how, full) }
  return { argv: ['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', how === 'text' ? EDIT : SELECT], stdin: full.replace(/\//g, '\\') }
}

export function openArgv(os: Platform, how: 'open' | 'text' | 'show', full: string): string[] {
  if (os === 'mac') return { open: ['open', full], text: ['open', '-t', full], show: ['open', '-R', full] }[how]
  if (os === 'linux') {
    const parent = full.replace(/\/[^/]*\/?$/, '') || '/'
    return { open: ['xdg-open', full], text: ['xdg-open', full], show: ['xdg-open', parent] }[how]
  }
  // Windows: explorer.exe takes the path as one argument, with no cmd.exe in between to read & or ^ in a name.
  const win = full.replace(/\//g, '\\')
  return { open: ['explorer.exe', win], text: ['notepad.exe', win], show: ['explorer.exe', `/select,${win}`] }[how]
}

// The path on a card comes from Claude's reply, so Open must never run a program. Documents and media open in
// their usual app; code and other text opens in a text editor (a .py or .sh opened normally can run); app
// bundles, installers, links and anything unknown are shown in their folder instead.
const DOCUMENT = /\.(md|markdown|pdf|png|jpe?g|gif|webp|svg|heic|tiff?|bmp|mp4|mov|m4v|webm|mp3|wav|m4a|aac|flac|ogg|html?|csv|tsv)$/i
const TEXT = /\.(txt|log|json|jsonc|toml|ya?ml|ini|cfg|conf|env\.example|xml|tsx?|jsx?|mjs|cjs|py|rb|go|rs|java|kt|swift|c|h|cc|cpp|hpp|cs|php|lua|sql|sh|bash|zsh|fish|ps1|psm1|bat|cmd|vbs|reg|css|scss|vue|svelte|diff|patch)$/i
const BUNDLE = /\.(app|bundle|framework|plugin|kext|prefpane|workflow|action|saver|appex|pkg|mpkg|qlgenerator|mdimporter)\/?$/i

export function openHow(path: string, kind: 'file' | 'dir' | 'other', isLink: boolean): 'open' | 'text' | 'show' {
  if (isLink || kind === 'other') return 'show'
  if (kind === 'dir') return BUNDLE.test(path) ? 'show' : 'open'
  if (DOCUMENT.test(path)) return 'open'
  // Code and other text, and dotfiles such as .gitignore.
  if (TEXT.test(path) || /[\\/]\.[^\\/.]+$/.test(path)) return 'text'

  return 'show'
}

// Why an Open failed, for the toast: the refusal or error, or the program's exit code and first line of output.
const why = (ran: { exitCode: number; stderr?: string } | undefined, failure: string) => {
  const detail = ran === undefined ? failure : `exit ${ran.exitCode}${ran.stderr?.trim() ? `: ${ran.stderr.trim().split('\n')[0]}` : ''}`

  return detail === '' ? '.' : ` (${detail.slice(0, 160)}).`
}

async function openUrl($: Engine, url: string) {
  if (!isUrl(url)) return
  const os = await where($)
  // On Windows the URL goes to explorer.exe as one argument; isUrl has already held it to http(s).
  const argv = os === 'mac' ? ['open', url] : os === 'linux' ? ['xdg-open', url] : ['explorer.exe', url]
  let failure = ''
  const ran = await $.process.run(argv).catch(error => {
    failure = String(error instanceof Error ? error.message : error)
    return undefined
  })
  const isOpened = ran !== undefined && (ran.exitCode === 0 || (ran.exitCode === 1 && os !== 'mac' && os !== 'linux'))
  if (!isOpened) $.ui.toast(`Could not open ${url} here${why(ran, failure)}`)
}

// True when the whole command already sits in one subshell: its first ( closes at its last ).
const isWrapped = (command: string) => {
  const text = command.trim()
  if (!text.startsWith('(') || !text.endsWith(')')) return false
  let depth = 0
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(') depth++
    else if (text[i] === ')') depth--
    if (depth === 0 && i < text.length - 1) return false
  }

  return depth === 0
}

// A pasted command runs in Claude's shared shell (! in the prompt), where a cd, export or source would stick
// for the rest of the session. Such a command is copied inside a subshell; one already wrapped is left alone.
const STICKY = /(^|[;&|(]\s*|\s)(cd|pushd|popd|export|unset|source|alias)(\s|$)|(^|[;&|]\s*)\.\s/
// On Windows a command is written for PowerShell, which has no ( … ) subshell, so it is copied as written.
export const forShell = (command: string, os?: Platform) =>
  os === 'windows' || isWrapped(command) || !STICKY.test(command) ? command : `( ${command.trim()} )`

// Where the person pastes a run line. On Windows that is PowerShell, the terminal's default; under WSL it is the
// distro's own shell, since a WSL command means nothing to PowerShell.
export function pasteInto(os: Platform, distro?: string) {
  if (os === 'windows') return { where: 'PowerShell', language: 'powershell' }
  if (os === 'wsl') return { where: `your ${distro ?? 'WSL'} terminal`, language: 'bash' }
  return { where: 'a terminal', language: 'bash' }
}

// Added to the format on Windows and WSL, where a run line pasted into the wrong shell fails.
export function shellNote(os: Platform, distro?: string) {
  if (os === 'windows') return `\n\nThe person is on Windows and pastes run lines into PowerShell, so write each \`run\` line in PowerShell syntax, not bash, even though your own shell is Git Bash: Windows paths, \`;\` between commands rather than \`&&\` (Windows PowerShell 5.1 has no \`&&\`), \`Set-Location\` or \`cd\` with an absolute path, and \`$env:NAME = 'value'\` for a variable.`
  if (os === 'wsl') return `\n\nThe person is on Windows, running you inside WSL (${distro ?? 'Linux'}). Write each \`run\` line for the WSL shell, in bash with Linux paths; the card tells them to paste it into their ${distro ?? 'WSL'} terminal, not PowerShell. When they need to run something on the Windows side, say so in a step instead.`
  return ''
}

// The surface's own clipboard first; the desktop app's is out of a mod's reach, so then the machine's.
const distroOf = async ($: Engine) => (await $.env.get('WSL_DISTRO_NAME').catch(() => undefined)) || undefined

async function copy($: Engine, text: string, surface: RenderSurface) {
  const os = await where($)
  const copied = `Copied. Paste it into ${pasteInto(os, await distroOf($)).where}.`
  const viaSurface = await $.ui.copy({ text, surface }).catch(() => ({ isCopied: false }))
  if (viaSurface.isCopied) {
    $.ui.toast(copied)
    return
  }
  // PowerShell reads the text as UTF-8. clip.exe is no fallback: it mangles anything outside the code page.
  const windows = [['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', '[Console]::InputEncoding = [Text.Encoding]::UTF8; Set-Clipboard -Value ([Console]::In.ReadToEnd())']]
  const tries = os === 'mac' ? [['pbcopy']] : os === 'linux' ? [['wl-copy'], ['xclip', '-selection', 'clipboard'], ['xsel', '--clipboard', '--input']] : windows
  for (const argv of tries) {
    const ran = await $.process.run(argv, { stdin: text }).catch(() => undefined)
    if (ran !== undefined && ran.exitCode === 0) {
      $.ui.toast(copied)
      return
    }
  }
  $.ui.toast('Could not reach the clipboard here; the command is on the card to copy by hand.')
}

async function save($: Engine) {
  const id = await $.session.id()
  const now = await $.clock.now()
  const all = ((await $.store.get(SAVED)) ?? {}) as Saved
  const kept: Saved = Object.fromEntries(Object.entries(all).filter(([, v]) => now - v.at < KEEP_MS))
  kept[id] = { items: await read($, items), seq: await read($, seq), at: now }
  await $.store.set(SAVED, kept)
}

// Turns the blocks of one reply message into cards, skipping blocks already read.
async function take($: Engine, text: string) {
  if (!text.includes('```handoff')) return
  const done = new Set(await read($, seen))
  const bodies = [...text.matchAll(FENCE)].map(m => (m[1] ?? '').trim()).filter(b => b !== '' && !done.has(b))
  if (bodies.length === 0) return
  await update($, seen, list => [...list, ...bodies].slice(-200))
  const root = await $.session.root()
  const now = await $.clock.now()
  const result = apply(await read($, items), bodies.map(parseBlock), await read($, seq), now, root)
  await update($, items, () => result.cards)
  await update($, seq, () => result.next)
  await save($)
  if (result.added.length > 0) {
    await $.ui.open({ id: PANE, title: TITLE })
    $.ui.toast(result.added.length === 1 ? `Handoff: ${result.added[0]?.title}` : `${result.added.length} new handoffs`)
  }
}

// A review path's folder, with the home folder written as ~.
const shortDir = (path: string) => path.slice(0, path.lastIndexOf('/')).replace(/^\/(Users|home)\/[^/]+/, '~') || '/'

async function setCard($: Engine, id: string, fn: (card: Handoff) => Handoff) {
  await update($, items, list => list.map(card => (card.id === id ? fn(card) : card)))
  await save($)
}

async function send($: Engine, id: string, markDone: boolean) {
  const card = (await read($, items)).find(card => card.id === id)
  if (card === undefined) return
  await setCard($, id, card => ({ ...card, isDirty: false, status: markDone ? 'done' : card.status }))
  await $.prompt.submit({ text: report(card, markDone ? 'done' : 'progress'), asUser: true })
  $.ui.toast(markDone ? `${card.id} sent and closed` : `${card.id} sent`)
}

// Closing a card sends nothing now: Claude hears it was closed, with any ticks, along with the next message.
async function closeCard($: Engine, id: string) {
  await setCard($, id, card => ({ ...card, status: 'done', isDirty: true }))
  $.ui.toast(`${id} closed`)
}

// Everything on the card is ticked and any choice made, so sending it finishes the card.
export const isFinished = (card: Handoff) =>
  card.steps.every(s => s.isDone) && (card.options.length === 0 || card.pick !== null)

// A choice-only card sends from its options. Otherwise Send shows once something is ticked or picked, or at once on
// a card with nothing to tick, where sending means it's done.
export const sendable = (card: Handoff) => {
  if (card.options.length > 0 && card.steps.length === 0) return false
  if (card.steps.length === 0) return true

  return card.steps.some(s => s.isDone) || card.pick !== null
}

const age = (then: number, now: number) => {
  const mins = Math.round((now - then) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`

  return `${Math.round(mins / (60 * 24))}d ago`
}

// Replaces each handoff block in a reply with a one-line pointer to its card.
const pointer = (text: string) =>
  text.replace(FENCE, (_, body: string) => {
    const b = parseBlock(body)
    if (b.close.length > 0 && b.need === '') return `*Handoff ${b.close.join(', ')} closed.*`

    return `> **Handoff · ${titleFrom(b)}** · waiting in the Handoffs pane (\`/handoffs\`)`
  })

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'handoffs', description: 'Open the Handoffs pane: what Claude is waiting on you for' })
    const { base, version } = await $.session.version()
    isRich = atLeast(base ?? version, MIN_VERSION)
    olderThanSupported = isRich ? undefined : base ?? version
    if (olderThanSupported !== undefined) $.ui.toast(notices()[0] ?? '')
    await noteVersion($).catch(() => undefined)
    // A new conversation never saw the message the format went with.
    if (delivery === 'submit' && (e.source === 'startup' || e.source === 'clear')) {
      delivery = undefined
      isTurnDone = false
    }
    // A resumed session gets its cards back.
    if ((await read($, items)).length === 0) {
      const mine = (((await $.store.get(SAVED)) ?? {}) as Saved)[await $.session.id()]
      if (mine !== undefined && mine.items.length > 0) {
        await update($, items, () => mine.items.map(card => ({ ...card, links: card.links ?? [], runs: card.runs ?? [] })))
        await update($, seq, () => mine.seq)
      }
    }
    // A reload (an edit to this mod) redraws the pane and band at once, not only at the next change.
    $.ui.invalidate('ui.render')
    // Under the auto theme, a change of the system's light or dark setting redraws the pane within a few seconds.
    $.clock.every(4_000, async () => {
      if ((await themeOf($)) !== 'auto') return
      const now = await systemMode($)
      if (now === appearance) return
      appearance = now
      $.ui.invalidate('ui.render')
    })

    return next(e)
  })

  on('command.run', { command: 'handoffs' }, async ($, e) => {
    await $.ui.open({ id: PANE, title: TITLE })
    const open = (await read($, items)).filter(card => card.status === 'open').length
    const opened = open === 0 ? 'Handoffs pane opened. Nothing is waiting on you.' : `Handoffs pane opened: ${open} waiting on you.`

    const news = notes.unread === undefined ? [] : [`Handoffs updated to ${notes.unread}.`, WHATS_NEW[notes.unread] ?? '', `What changed: ${CHANGELOG}`]
    const said = [opened, ...(e.presentation?.isFullscreen === false ? [FULLSCREEN_HINT] : []), ...notices(), deliveryNote(), ...news]

    return { text: said.filter(line => line !== '').join(' ') }
  })

  // A theme change repaints Claude Code's own ground at once; the pane and band draw again with it, so their accents
  // switch too, and auto looks at the system afresh.
  on('config.set', { key: 'theme' }, async ($, e, next) => {
    const written = await next(e)
    appearance = undefined
    $.ui.invalidate('ui.render')
    return written
  }).catch(($, e, next) => next(e)) // the theme is always written, whatever happens here

  // Teaches the block format.
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    const sections = [...composed.sections, { id: 'handoffs:format', text: await formatText($), scope: 'session' as const }]
    // Marked only once the section is written, so a failure here leaves the first-message fallback to send it.
    if (delivery !== 'system') {
      // A slash command before the first message has the context built first; ask for it again, now without the copy.
      if (delivery === 'message') $.ui.invalidate('prompt.context')
      delivery = 'system'
      $.ui.invalidate('ui.render')
    }
    // Nothing skips it any more: later sessions stop sending the format with their first message.
    if (notes.isSkipped === true) await putAway($, { isSkipped: undefined })

    return { ...composed, sections }
  }).catch(($, e, next) => next(e))

  // A host that brings its own system prompt (`--system-prompt`, or an SDK host replacing it) composes none, so
  // prompt.compose never fires; the format then rides the first message's context instead.
  on('prompt.context', async ($, e, next) => {
    const context = await next(e)
    if (delivery === 'system') return context
    const blocks = [...context.blocks, { name: 'handoffs', text: await formatText($) }]
    delivery = 'message'
    $.ui.invalidate('ui.render')
    if (notes.isSkipped === true) await putAway($, { isSkipped: undefined })

    return { ...context, blocks }
  })

  // Reads handoff blocks from every main-loop reply message as it is kept, not only the turn's last text:
  // a block written before a tool call is caught too.
  on('session.append', { door: 'response' }, async ($, e, next) => {
    const kept = await next(e)
    if (e.agentId === undefined && e.message.type === 'assistant') {
      const content = e.message.content
      const text = typeof content === 'string' ? content
        : content.map(block => (block.type === 'text' && typeof block.text === 'string' ? block.text : '')).join('\n')
      await take($, text).catch(error => $.ui.log(`handoffs: could not read a block: ${String(error)}`))
    }

    return kept
  }).catch(($, e, next) => next(e))

  // And the turn's final answer, for hosts that keep no rows; a block already read is skipped.
  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined && e.reason === 'answer') await take($, e.answer)
    if (e.agentId === undefined && !isTurnDone) {
      isTurnDone = true
      // Both prompt hooks were passed over: the person's next message carries the format, here and from now on.
      if (delivery === undefined) await putAway($, { isSkipped: true }).catch(() => $.ui.invalidate('ui.render'))
    }

    return next(e)
  })

  // Clicks not yet sent ride along with the person's next message.
  on('prompt.submit', async ($, e, next) => {
    // The person's own messages, and prompts another mod sends for them (a /peek); never this mod's own sends.
    const origin = e.origin
    const isOwn = origin.kind === 'plugin' && origin.name === SELF
    const isPersons = !isOwn && origin.kind !== 'task-notification' && origin.kind !== 'scheduled-trigger' && origin.kind !== 'peer'
    if (!isPersons || e.command !== undefined || e.isMeta === true) return next(e)
    const list = await read($, items)
    const dirty = list.filter(card => card.isDirty)
    const told: string[] = []
    if (delivery === undefined && (isTurnDone || notes.isSkipped === true)) {
      told.push(await formatText($))
      delivery = 'submit'
      $.ui.invalidate('ui.render')
    } else if (delivery === 'submit') told.push(REMINDER)
    if (dirty.length > 0) {
      // A card with everything ticked and any choice made is finished: the message closes it, no button needed.
      const finished = (card: Handoff) => card.status === 'open' && isFinished(card)
      await update($, items, cards => cards.map(card =>
        card.isDirty ? { ...card, isDirty: false, status: finished(card) ? 'done' : card.status } : card))
      await save($)
      const changes = dirty.map(card => report(card, card.status === 'done' ? 'closed' : finished(card) ? 'done' : 'progress')).join('\n\n')
      told.push(`The person changed these handoff cards since you last heard. Say in a few words at the start of your reply that you got this update, so they know their ticks reach you. A card that's plainly finished but still open, close it with a close block.\n\n${changes}`)
    }
    // Every message carries the open cards, so a new request updates its topic's card instead of adding one.
    const open = list.filter(card => card.status === 'open' && !card.isDirty)
    if (open.length > 0) told.push(openList(open))
    if (told.length === 0) return next(e)

    return next({ ...e, context: [...(e.context ?? []), ...told] })
  }).catch(($, e, next) => next(e))

  // A compaction keeps every open request: the cards go back in after the summary.
  on('session.compact', async ($, e, next) => {
    const done = await next(e)
    if (done.skip !== undefined || e.trigger === 'precompute' || e.agentId !== undefined) return done
    const open = (await read($, items)).filter(card => card.status === 'open')
    if (open.length === 0) return done
    const text =
      `These handoff cards are still open in the Handoffs pane, waiting on the person:\n\n` +
      open.map(card => report(card, 'open')).join('\n\n')

    return { ...done, messages: [...done.messages, { role: 'user', text, toolUses: [] }] }
  }).catch(($, e, next) => next(e))

  // Claude's own question dialog is waiting on the person too, until it's answered or dismissed.
  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    asking = askedOf((e as { questions?: unknown }).questions)
    $.ui.invalidate('ui.render')
    try {
      return await next(e)
    } finally {
      asking = undefined
      $.ui.invalidate('ui.render')
    }
  })

  // The raw block becomes a one-line pointer in the transcript.
  on('ui.render', { component: 'AssistantMessage' }, ($, e, next) => {
    if (!e.props.text.includes('```handoff')) return next(e)

    return next({ ...e, props: { ...e.props, text: pointer(e.props.text) } })
  })

  // "Waiting on you" while anything is open.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const open = (await read($, items)).filter(card => card.status === 'open')
    const asked = asking
    if ((open.length === 0 && asked === undefined) || e.props.hasSurvey) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const first = open[0]
    const below = await next(e)

    // The band sits on the terminal's own background, which can be light under a dark theme (a light terminal with
    // the default theme), so its text takes the terminal's own colour and only the outline is Violet, which reads on both.
    return (
      <Box flexDirection="column">
        <Box key="waiting" flexDirection="row" alignItems="center" gap='sm' paddingX='sm' borderStyle="round" borderColor={ACCENTS.dark.outline}>
          <Text {...face({ weight: 'bold' })}>Waiting on you:</Text>
          <Text {...face({ weight: 'semibold' })} wrap="truncate-end">
            {asked !== undefined ? `Claude asked you ${asked.count === 1 ? 'a question' : `${asked.count} questions`}`
              : open.length === 1 ? first?.title : `${open.length} handoffs`}
            {asked !== undefined && open.length > 0 && <Text> · {open.length === 1 ? '1 handoff' : `${open.length} handoffs`}</Text>}
            {asked === undefined && open.length > 1 && <Text> · {first?.title}</Text>}
          </Text>
          {open.length > 0 && <Button key="open-pane" label="Open" variant="primary" onPress={() => void $.ui.open({ id: PANE, title: TITLE })} />}
        </Box>
        {below}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Button, Code, Text } = elements
    const Svg = 'Svg' in elements ? elements.Svg : undefined
    const list = await read($, items)
    const isDoneShown = await read($, showDone)
    const now = await $.clock.now()
    const open = list.filter(card => card.status === 'open')
    const done = list.filter(card => card.status === 'done')
    const system = await where($)
    const A = e.surface === 'terminal' ? ACCENTS[await modeOf($)] : IN_APP
    const paste = pasteInto(system, await distroOf($))

    const label = (text: string, aside?: string) => (
      <Text {...face({ size: 'title', weight: 'bold' })} color={A.heading}>
        {text}{aside !== undefined && <Text {...face({ weight: 'regular' })} color={INK}>  {aside}</Text>}
      </Text>
    )

    // A secondary button's label in warm brass. The app draws the button itself, so its fill stays its own;
    // a primary button is white there, and keeps its dark label.
    const brass = (text: string) => <Text color={A.brass}>{text}</Text>

    const cardView = (card: Handoff) => {
      const ticked = card.steps.filter(s => s.isDone).length

      return (
        <Box key={`card-${card.id}`} flexDirection="column" rowGap='md' paddingX='md' paddingY='md' backgroundColor={A.card} borderStyle="round" borderColor={A.outline}>
          <Box flexDirection="row" justifyContent="space-between" alignItems="center">
            <Text {...face({ mono: true, size: 'footnote' })} color={INK}>{card.id.toUpperCase()} · {age(card.createdAt, now)}</Text>
            <Button key={`close-${card.id}`} plain dimColor label="✕" onPress={() => void closeCard($, card.id)} />
          </Box>
          <Text {...face({ size: 'title', weight: 'bold' })} color={A.steel}>{card.title}</Text>

          <Box flexDirection="column">
            {label('What is needed')}
            <Text color={INK}>{card.need}</Text>
          </Box>
          {card.why !== '' && (
            <Box flexDirection="column">
              {label('Why')}
              <Text color={INK}>{card.why}</Text>
            </Box>
          )}

          {card.steps.length > 0 && (
            <Box flexDirection="column">
              {label('Steps', `${ticked} of ${card.steps.length} done`)}
              {card.steps.map((s, i) => (
                <Box key={`row-${card.id}-${i}`} flexDirection="row" alignItems="flex-start" gap='sm'>
                  <Button key={`step-${card.id}-${i}`} plain label={s.isDone ? '☑' : '☐'}
                    onPress={() => void setCard($, card.id, c => ({
                      ...c, isDirty: true,
                      steps: c.steps.map((x, j) => (j === i ? { ...x, isDone: !x.isDone } : x)),
                    }))} />
                  <Text color={s.isDone ? DIM_INK : INK} strikethrough={s.isDone}>{s.text}</Text>
                </Box>
              ))}
            </Box>
          )}

          {card.options.length > 0 && (
            <Box flexDirection="column" rowGap='sm'>
              {label('Decide')}
              <Box flexDirection="row" flexWrap="wrap" columnGap='md' rowGap='md' marginTop='md'>
                {card.options.map(o => (
                  <Button key={`pick-${card.id}-${o}`} label={card.pick === o ? `✓ ${o}` : o}
                    variant={card.pick === o ? 'primary' : 'secondary'}
                    onPress={() => void (card.steps.length === 0
                      ? setCard($, card.id, c => ({ ...c, pick: o })).then(() => send($, card.id, true))
                      : setCard($, card.id, c => ({ ...c, isDirty: true, pick: c.pick === o ? null : o })))}>
                    {card.pick === o ? `✓ ${o}` : brass(o)}
                  </Button>
                ))}
              </Box>
            </Box>
          )}

          {card.reviews.length > 0 && (
            <Box flexDirection="column" rowGap='sm'>
              {label('Review')}
              {card.reviews.map(path => (
                <Box key={`rev-${card.id}-${path}`} flexDirection="row" alignItems="center" gap='sm'>
                  <Button key={`open-${card.id}-${path}`} label="Open" onPress={() => void openFile($, card, path)}>{brass('Open')}</Button>
                  <Text wrap="truncate-start">
                    <Text {...face({ weight: 'semibold' })} color={INK}>{path.split('/').pop()}</Text>
                    {path.includes('/') && <Text {...face({ mono: true })} color={INK}>  {shortDir(path)}</Text>}
                  </Text>
                </Box>
              ))}
            </Box>
          )}

          {card.links.length > 0 && (
            <Box flexDirection="column" rowGap='sm'>
              {label('Links')}
              {card.links.map(link => (
                <Box key={`link-${card.id}-${link.url}`} flexDirection="row" alignItems="center" gap='sm'>
                  <Button key={`url-${card.id}-${link.url}`} label="Open" onPress={() => void openUrl($, link.url)}>{brass('Open')}</Button>
                  <Text wrap="truncate-end">
                    <Text {...face({ weight: 'semibold' })} color={INK}>{link.label}</Text>
                    {link.label !== link.url.replace(/^https?:\/\/(www\.)?/, '') && (
                      <Text {...face({ mono: true })} color={INK}>  {link.url.replace(/^https?:\/\//, '')}</Text>
                    )}
                  </Text>
                </Box>
              ))}
            </Box>
          )}

          {card.runs.length > 0 && (
            <Box flexDirection="column" rowGap='md'>
              {label('Run', system === 'wsl' || system === 'windows' ? `in ${paste.where.replace(/^your /, '')}` : undefined)}
              {card.runs.map((command, i) => (
                <Box key={`run-${card.id}-${i}`} flexDirection="column" rowGap='sm'>
                  <Code source={forShell(command, system)} language={paste.language} />
                  <Box flexDirection="row">
                    <Button key={`copy-${card.id}-${i}`} label="Copy" onPress={press => void copy($, forShell(command, system), press.surface)}>
                      {brass('Copy')}
                    </Button>
                  </Box>
                </Box>
              ))}
            </Box>
          )}

          {sendable(card) && (
            <Box flexDirection="row" marginTop='xl'>
              <Button key={`send-${card.id}`} label={isFinished(card) ? 'Send and close' : 'Send'} variant="primary"
                onPress={() => void send($, card.id, isFinished(card))} />
            </Box>
          )}
        </Box>
      )
    }

    const asked = asking
    const waiting = open.length + (asked === undefined ? 0 : 1)

    return (
      <Box flexDirection="column" rowGap='md' padding={1} backgroundColor={A.ground}>
        <Box flexDirection="row" alignItems="center" gap='md'>
          {Svg !== undefined && <Svg key="monogram" source={MONOGRAM} alt="Ghost Hat Studio" width={24} height={32} />}
          <Box flexDirection="column">
            <Text {...face({ mono: true, size: 'footnote', weight: 'bold' })} color={A.steel}>GHOST HAT STUDIO · HANDOFFS</Text>
            <Text {...face({ size: 'title', weight: 'bold' })} color={A.steel}>
              {waiting === 0 ? 'Nothing waiting on you' : `${waiting} waiting on you`}
            </Text>
            {waiting === 0 && (
              <Text color={INK}>When Claude needs you to do or decide something, it lands here as a card.</Text>
            )}
            {e.surface === 'terminal' && e.viewport?.isFullscreen === false && <Text color={DIM_INK}>{FULLSCREEN_HINT}</Text>}
            {notices().map(notice => <Text key={notice} color={INK} {...face({ weight: 'semibold' })}>{notice}</Text>)}
            {notes.unread !== undefined && (
              <Box key="news" flexDirection="column">
                <Text color={INK} {...face({ weight: 'semibold' })}>Handoffs updated to {notes.unread}.</Text>
                <Text color={INK}>{`${WHATS_NEW[notes.unread] ?? ''} What changed: ${CHANGELOG}`.trim()}</Text>
                <Button key="news-done" plain dimColor label="Got it" onPress={() => void putAway($, { unread: undefined })} />
              </Box>
            )}
            {notes.isTipDone !== true && (
              <Box key="tip" flexDirection="column">
                <Text color={INK}>{TIP}</Text>
                <Button key="tip-done" plain dimColor label="Got it" onPress={() => void putAway($, { isTipDone: true })} />
              </Box>
            )}
          </Box>
        </Box>

        {asked !== undefined && (
          <Box key="asking" flexDirection="column" rowGap='sm' paddingX='md' paddingY='md' backgroundColor={A.card} borderStyle="round" borderColor={A.outline}>
            {label(asked.count === 1 ? 'Claude asked you a question' : `Claude asked you ${asked.count} questions`)}
            {asked.first !== '' && <Text color={INK} {...face({ weight: 'semibold' })}>{asked.first}</Text>}
            <Text color={INK}>Answer it in the conversation, and Claude carries on.</Text>
          </Box>
        )}

        {open.map(cardView)}

        {done.length > 0 && (
          <Box key="done" flexDirection="column" rowGap='sm' marginTop='md'>
            <Box flexDirection="row" alignItems="center" gap='sm'>
              <Button key="toggle-done" plain dimColor label={isDoneShown ? `▾ Done (${done.length})` : `▸ Done (${done.length})`}
                onPress={() => void update($, showDone, x => !x)} />
              {isDoneShown && (
                <Button key="clear-done" plain dimColor label="Clear"
                  onPress={() => void update($, items, l => l.filter(card => card.status !== 'done')).then(() => save($))} />
              )}
            </Box>
            {isDoneShown && done.map(card => (
              <Box key={`done-${card.id}`} flexDirection="row" alignItems="center" gap='sm'>
                <Text {...face({ mono: true })} color={INK}>{card.id.toUpperCase()}</Text>
                <Text color={DIM_INK} strikethrough wrap="truncate-end">{card.title}</Text>
                {card.pick !== null && <Text color={INK}> · {card.pick}</Text>}
                <Button key={`reopen-${card.id}`} plain dimColor label="Reopen"
                  onPress={() => void setCard($, card.id, c => ({ ...c, status: 'open' }))} />
              </Box>
            ))}
          </Box>
        )}
      </Box>
    )
  })
}
