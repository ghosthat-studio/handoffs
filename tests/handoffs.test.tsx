import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { apply, forShell, openArgv, openHow, openList, openRun, parseAnswer, pasteInto, shellNote } from '../hooks/register.tsx'

// The Mac's light or dark setting, as `defaults read -g AppleInterfaceStyle` reports it: '' in light mode.
const system = { style: '' }

// What the engine would answer beneath the plugin in a session.
function engine(on: On, version = '2.1.299', stored: Record<string, unknown> = {}) {
  const ran: { argv: readonly string[]; stdin?: string }[] = []
  mock.store(on, stored)
  on('session.id', () => ({ value: 's1' }))
  on('ui.copy', () => ({ value: { isCopied: false, reason: 'no-surface' } }))
  on('process.run', ($, e) => {
    ran.push({ argv: e.argv, stdin: e.init?.stdin })
    // macOS answers AppleInterfaceStyle only in dark mode; in light mode the key is absent and defaults exits 1.
    const stdout = e.argv[0] === 'uname' ? 'Darwin\n' : e.argv[0] === 'defaults' ? system.style : ''
    const exitCode = e.argv[0] === 'defaults' && system.style === '' ? 1 : 0
    return { value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('session.start', ($, e) => e)
  on('command.register', () => ({ value: undefined }))
  on('session.version', () => ({ value: { version, base: version } }))
  const clock = mock.clock(on, { now: Date.parse('2026-10-15T20:00:00Z') })
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('session.root', () => ({ value: '/work/project' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('prompt.compose', () => ({ sections: [] }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{e.component === 'AssistantMessage' ? e.props.text : ''}</Text>
  })

  return { ran, clock }
}

const PANE = {
  component: 'Pane',
  requestId: 'handoffs',
  props: { title: 'Handoffs', isFocused: false, bodyColumns: 70, placement: 'dock', scroll: { offset: 0, bodyRows: 60 } },
} as const

const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

const REPLY = [
  'The two thumbnails are rendered.',
  '',
  '```handoff',
  'title: Pick the 002 thumbnail',
  'need: Choose which thumbnail goes on episode 002.',
  'why: The upload is scheduled for Monday.',
  'step: Open both thumbnails',
  'step: Check them at phone size',
  'decide: Lantern | Server rack | Neither',
  'review: youtube/002/thumb-a.png',
  '```',
].join('\n')

const finish = (answer: string) => ({ answer, durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' as const })

test('a reply with a handoff block becomes a card the person can tick, pick and send', async ($, on) => {
  engine(on)
  const sent: string[] = []
  on('prompt.submit', ($, e) => {
    sent.push(e.text)
    return { text: e.text }
  })

  await $.session.start({ source: 'startup', cwd: '/work/project' } as never)
  await $.turn.complete(finish(REPLY))

  for (const surface of ['terminal', 'desktop'] as const) {
    const pane = await $.ui.mount({ plugin: 'handoffs', surface, ...PANE })
    expect((await pane.find({ type: 'Text', text: /Pick the 002 thumbnail/ }))).toBeDefined()
    expect((await pane.find({ key: 'open-h1-youtube/002/thumb-a.png' }))).toBeDefined()
    await pane.unmount()
  }

  const pane = await $.ui.mount({ plugin: 'handoffs', surface: 'desktop', ...PANE })
  await pane.press({ key: 'step-h1-0' })
  await pane.press({ key: 'pick-h1-Server rack' })
  expect((await pane.find({ key: 'pick-h1-Server rack' }))?.props.label).toBe('✓ Server rack')
  expect((await pane.find({ type: 'Text', text: 'Unsent changes' }))).toBeDefined()

  await pane.press({ key: 'send-h1' })
  expect(sent).toHaveLength(1)
  expect(sent[0]).toContain('Handoff h1 (Pick the 002 thumbnail): progress so far.')
  expect(sent[0]).toContain('- [x] Open both thumbnails')
  expect(sent[0]).toContain('- [ ] Check them at phone size')
  expect(sent[0]).toContain('Decision: Server rack')
  expect((await pane.find({ type: 'Text', text: 'Unsent changes' }))).toBeUndefined()

  await pane.press({ key: 'done-h1' })
  expect(sent[1]).toContain('marked done')
  expect((await pane.find({ type: 'Text', text: /Nothing waiting on you/ }))).toBeDefined()
})

test('the band waits while a card is open and steps aside when none is', async ($, on) => {
  engine(on)
  on('prompt.submit', ($, e) => ({ text: e.text }))

  await $.session.start({ source: 'startup', cwd: '/work/project' } as never)
  const empty = await $.ui.mount({ plugin: 'handoffs', surface: 'terminal', ...BAND })
  expect(await empty.find({ key: 'open-pane' })).toBeUndefined()
  await empty.unmount()

  await $.turn.complete(finish(REPLY))
  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({ plugin: 'handoffs', surface, ...BAND })
    expect(await band.find({ type: 'Text', text: /Waiting on you/ })).toBeDefined()
    expect(await band.find({ key: 'open-pane' })).toBeDefined()
    await band.unmount()
  }
})

test('clicks not yet sent ride along with the next message, once', async ($, on) => {
  engine(on)
  const contexts: (readonly string[] | undefined)[] = []
  on('prompt.submit', ($, e) => {
    contexts.push(e.context)
    return { text: e.text }
  })

  await $.session.start({ source: 'startup', cwd: '/work/project' } as never)
  await $.turn.complete(finish(REPLY))
  const pane = await $.ui.mount({ plugin: 'handoffs', surface: 'terminal', ...PANE })
  await pane.press({ key: 'pick-h1-Lantern' })

  await $.prompt.submit({ text: 'Here you go', asUser: true })
  // A plugin's own prompt is not the person's message: nothing rides on it.
  expect(contexts[0]).toBeUndefined()
})

test('a later block with the same id changes the card; a close block closes it', async ($, on) => {
  engine(on)
  on('prompt.submit', ($, e) => ({ text: e.text }))
  await $.session.start({ source: 'startup', cwd: '/work/project' } as never)
  await $.turn.complete(finish(REPLY))
  await $.turn.complete(finish('```handoff\nid: h1\nneed: Choose the thumbnail.\ndecide: Lantern | Rack\n```'))

  const pane = await $.ui.mount({ plugin: 'handoffs', surface: 'terminal', ...PANE })
  expect(await pane.find({ key: 'pick-h1-Rack' })).toBeDefined()
  expect(await pane.find({ key: 'pick-h2-Rack' })).toBeUndefined()

  await $.turn.complete(finish('Done on my side.\n\n```handoff\nclose: h1\n```'))
  await pane.redraw()
  expect(await pane.find({ type: 'Text', text: /Nothing waiting on you/ })).toBeDefined()
})

test('open cards go back into the conversation after a compaction', async ($, on) => {
  engine(on)
  on('session.compact', () => ({ messages: [{ role: 'user', text: 'summary', toolUses: [] }] }))
  await $.session.start({ source: 'startup', cwd: '/work/project' } as never)
  await $.turn.complete(finish(REPLY))

  const compacted = await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'old', toolUses: [] }] } as never)
  expect(compacted.skip).toBeUndefined()
  const last = compacted.messages?.at(-1)
  expect(last?.text).toContain('still open in the Handoffs pane')
  expect(last?.text).toContain('Handoff h1 (Pick the 002 thumbnail) is still open.')
})

test('the transcript shows a pointer in place of the raw block', async ($, on) => {
  engine(on)
  await $.session.start({ source: 'startup', cwd: '/work/project' } as never)
  const row = await $.ui.mount({
    plugin: 'handoffs', surface: 'terminal', component: 'AssistantMessage', requestId: 'm1',
    props: { text: REPLY, isFirstOfReply: true },
  })
  const shown = (await row.find({ type: 'Text' }))?.text ?? ''
  expect(shown).toContain('Handoff · Pick the 002 thumbnail')
  expect(shown).not.toContain('decide:')
})

test('an older build draws the card without the faces it would refuse', async ($, on) => {
  engine(on, '2.1.296')
  await $.session.start({ source: 'startup', cwd: '/work/project' } as never)
  await $.turn.complete(finish(REPLY))
  const pane = await $.ui.mount({ plugin: 'handoffs', surface: 'terminal', ...PANE })
  const heading = await pane.find({ type: 'Text', text: /GHOST HAT/ })
  expect(heading?.props.mono).toBeUndefined()
  expect(heading?.props.bold).toBe(true)
})

const LINKED = [
  '```handoff',
  'title: Merge the CMS PR',
  'need: Review and merge the pull request, then check staging at https://staging.ghosthat.ai/studio.',
  'step: Read the diff',
  'step: Merge it',
  'review: https://github.com/owner/repo/pull/22',
  'review: cms/studio/README.md',
  'link: Gmail thread | https://mail.google.com/mail/u/0/#inbox/abc123',
  'run: cd /home/me/project && npm run deploy',
  '```',
].join('\n')

test('links get Open buttons and commands get a Copy button', async ($, on) => {
  const { ran } = engine(on)
  await $.session.start({ source: 'startup', cwd: '/work/project' } as never)
  await $.turn.complete(finish(LINKED))
  const pane = await $.ui.mount({ plugin: 'handoffs', surface: 'desktop', ...PANE })

  expect(await pane.find({ key: 'url-h1-https://github.com/owner/repo/pull/22' })).toBeDefined()
  expect(await pane.find({ key: 'url-h1-https://mail.google.com/mail/u/0/#inbox/abc123' })).toBeDefined()
  expect(await pane.find({ key: 'url-h1-https://staging.ghosthat.ai/studio' })).toBeDefined()
  // The URL review moved to Links; the local file stays under Review.
  expect(await pane.find({ key: 'open-h1-https://github.com/owner/repo/pull/22' })).toBeUndefined()
  expect(await pane.find({ key: 'open-h1-cms/studio/README.md' })).toBeDefined()

  await pane.press({ key: 'url-h1-https://github.com/owner/repo/pull/22' })
  expect(ran.some(r => r.argv[0] === 'open' && r.argv[1] === 'https://github.com/owner/repo/pull/22')).toBe(true)

  await pane.press({ key: 'copy-h1-0' })
  const copied = ran.find(r => r.argv[0] === 'pbcopy')
  expect(copied?.stdin).toBe('( cd /home/me/project && npm run deploy )')
})

test('rewriting a card by id drops what the new block leaves out and keeps ticks', async ($, on) => {
  engine(on)
  await $.session.start({ source: 'startup', cwd: '/work/project' } as never)
  await $.turn.complete(finish(LINKED))
  const pane = await $.ui.mount({ plugin: 'handoffs', surface: 'terminal', ...PANE })
  await pane.press({ key: 'step-h1-0' })

  await $.turn.complete(finish('```handoff\nid: h1\nneed: Merge the pull request.\nstep: Read the diff\nstep: [x] Merge it\nstep: Check staging\n```'))
  await pane.redraw()
  expect(await pane.find({ key: 'open-h1-cms/studio/README.md' })).toBeUndefined()
  expect(await pane.find({ key: 'copy-h1-0' })).toBeUndefined()
  expect((await pane.find({ key: 'step-h1-0' }))?.props.label).toBe('☑')
  expect((await pane.find({ key: 'step-h1-1' }))?.props.label).toBe('☑')
  expect((await pane.find({ key: 'step-h1-2' }))?.props.label).toBe('☐')
})

test('a block read twice makes one card', async ($, on) => {
  engine(on)
  await $.session.start({ source: 'startup', cwd: '/work/project' } as never)
  await $.turn.complete(finish(REPLY))
  await $.turn.complete(finish(REPLY))
  const pane = await $.ui.mount({ plugin: 'handoffs', surface: 'terminal', ...PANE })
  expect(await pane.find({ key: 'card-h2' })).toBeUndefined()
})

test('a resumed session gets its cards back, aged in hours', async ($, on) => {
  const card = {
    id: 'h4', title: 'Saved card', need: 'Still needed.', why: '', steps: [], options: [], pick: null,
    reviews: [], root: '/work', status: 'open', createdAt: Date.parse('2026-10-15T17:00:00Z'), isDirty: false,
  }
  engine(on, '2.1.299', { sessions: { s1: { items: [card], seq: 5, at: Date.parse('2026-10-15T19:00:00Z') } } })
  await $.session.start({ source: 'resume', cwd: '/work/project' } as never)
  const pane = await $.ui.mount({ plugin: 'handoffs', surface: 'terminal', ...PANE })
  expect(await pane.find({ type: 'Text', text: /Saved card/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /3h ago/ })).toBeDefined()
})

test('a command that would move the shared shell is copied inside a subshell; others are left as they are', () => {
  expect(forShell('cd /abs/cms/studio && npm run deploy')).toBe('( cd /abs/cms/studio && npm run deploy )')
  expect(forShell('export NODE_ENV=production; npm run build')).toBe('( export NODE_ENV=production; npm run build )')
  expect(forShell('source .venv/bin/activate && pytest')).toBe('( source .venv/bin/activate && pytest )')
  expect(forShell('( cd /abs/cms/studio && npm run deploy )')).toBe('( cd /abs/cms/studio && npm run deploy )')
  expect(forShell('(cd /a && make)')).toBe('(cd /a && make)')
  // Two subshells side by side are not one wrap: the cd between them would still stick.
  expect(forShell('(make a) && cd /b && (make c)')).toBe('( (make a) && cd /b && (make c) )')
  expect(forShell('gh pr merge 22 --squash')).toBe('gh pr merge 22 --squash')
  expect(forShell('npm run abcd')).toBe('npm run abcd')
})

test('Open never runs a program: documents open, code opens as text, apps and links are shown in their folder', () => {
  expect(openHow('/p/notes.md', 'file', false)).toBe('open')
  expect(openHow('/p/thumb.PNG', 'file', false)).toBe('open')
  expect(openHow('/p/run.py', 'file', false)).toBe('text')
  expect(openHow('/p/deploy.sh', 'file', false)).toBe('text')
  expect(openHow('/p/.gitignore', 'file', false)).toBe('text')
  expect(openHow('/p/folder', 'dir', false)).toBe('open')
  expect(openHow('/Applications/Evil.app', 'dir', false)).toBe('show')
  expect(openHow('/p/setup.pkg', 'file', false)).toBe('show')
  expect(openHow('/p/start.command', 'file', false)).toBe('show')
  expect(openHow('/p/binary', 'file', false)).toBe('show')
  expect(openHow('/p/notes.md', 'file', true)).toBe('show')
  expect(openHow('/p/gone', 'other', false)).toBe('show')
})

test('on Windows, Open never runs a program either: scripts open as text, programs are shown in their folder', () => {
  expect(openHow('C:\\p\\report.pdf', 'file', false)).toBe('open')
  expect(openHow('C:\\p\\install.bat', 'file', false)).toBe('text')
  expect(openHow('C:\\p\\setup.ps1', 'file', false)).toBe('text')
  expect(openHow('C:\\p\\.env', 'file', false)).toBe('text')
  expect(openHow('C:\\p\\setup.exe', 'file', false)).toBe('show')
  expect(openHow('C:\\p\\Shortcut.lnk', 'file', false)).toBe('show')
  expect(openHow('C:\\p\\setup.msi', 'file', false)).toBe('show')
})

test('each platform opens with its own tool, and Windows gets the path as one argument with no shell', () => {
  expect(openArgv('mac', 'show', '/p/a b.png')).toEqual(['open', '-R', '/p/a b.png'])
  expect(openArgv('linux', 'show', '/p/a.png')).toEqual(['xdg-open', '/p'])
  expect(openArgv('windows', 'open', 'C:/p/a&b.png')).toEqual(['explorer.exe', 'C:\\p\\a&b.png'])
  expect(openArgv('wsl', 'text', '\\\\wsl.localhost\\Ubuntu\\p\\run.py')).toEqual(['notepad.exe', '\\\\wsl.localhost\\Ubuntu\\p\\run.py'])
  expect(openArgv('windows', 'show', 'C:\\p\\setup.exe')).toEqual(['explorer.exe', '/select,C:\\p\\setup.exe'])
})

test('a block with no id but the title of an open card updates that card and keeps its ticks', () => {
  const [first] = parseAnswer('```handoff\ntitle: Launch handoffs\nneed: Say go.\nstep: Read the README\nstep: Check staging\n```')
  const start = apply([], [first!], 1, 0, '/work')
  const ticked = start.cards.map(c => ({ ...c, steps: c.steps.map((s, i) => (i === 0 ? { ...s, isDone: true } : s)) }))
  const [again] = parseAnswer('```handoff\ntitle: launch  Handoffs\nneed: Say go once the fixes are in.\nstep: Read the README\nstep: Try the new cards\n```')
  const after = apply(ticked, [again!], start.next, 1, '/work')
  expect(after.cards).toHaveLength(1)
  expect(after.added).toHaveLength(0)
  expect(after.cards[0]?.id).toBe('h1')
  expect(after.cards[0]?.need).toBe('Say go once the fixes are in.')
  expect(after.cards[0]?.steps).toEqual([{ text: 'Read the README', isDone: true }, { text: 'Try the new cards', isDone: false }])

  // A closed card with that title is history: a new request on it is a new card.
  const closed = after.cards.map(c => ({ ...c, status: 'done' as const }))
  expect(apply(closed, [again!], after.next, 2, '/work').added).toHaveLength(1)
  // A different topic is a separate card.
  const [other] = parseAnswer('```handoff\ntitle: Old Nain episode\nneed: Pick the angle.\n```')
  expect(apply(after.cards, [other!], after.next, 2, '/work').cards).toHaveLength(2)
})

test('the open-card list names each card, its steps and its decision, and asks Claude to check it first', () => {
  const [b] = parseAnswer('```handoff\ntitle: Launch handoffs\nneed: Say go.\nstep: Read the README\ndecide: Go | Wait\n```')
  const text = openList(apply([], [b!], 1, 0, '/work').cards)
  expect(text).toContain('Before writing a new handoff block, check these')
  expect(text).toContain('h1: Launch handoffs')
  expect(text).toContain('Needed: Say go.')
  expect(text).toContain('- [ ] Read the README')
  expect(text).toContain('Decision: not made yet (Go / Wait)')
})

test('run lines follow the shell they are pasted into', () => {
  // PowerShell has no ( … ) subshell, so a Windows command is copied as written.
  expect(forShell('Set-Location C:\\proj; npm run deploy', 'windows')).toBe('Set-Location C:\\proj; npm run deploy')
  expect(forShell('cd /abs && make', 'windows')).toBe('cd /abs && make')
  expect(forShell('cd /abs && make', 'wsl')).toBe('( cd /abs && make )')
  expect(pasteInto('windows')).toEqual({ where: 'PowerShell', language: 'powershell' })
  expect(pasteInto('wsl', 'Ubuntu').where).toBe('your Ubuntu terminal')
  expect(pasteInto('wsl').where).toBe('your WSL terminal')
  expect(pasteInto('mac').where).toBe('a terminal')
  expect(shellNote('windows')).toContain('PowerShell syntax')
  expect(shellNote('wsl', 'Ubuntu')).toContain('Ubuntu terminal, not PowerShell')
  expect(shellNote('mac')).toBe('')
  expect(shellNote('linux')).toBe('')
})

test('on Windows, text opens with its Edit action or Notepad, and Explorer /select starts through PowerShell, the path on stdin', () => {
  const text = openRun('windows', 'text', 'C:/p/setup & go.bat')
  expect(text.argv.slice(0, 4)).toEqual(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command'])
  expect(text.argv[4]).toContain('-Verb Edit')
  expect(text.argv[4]).toContain('Start-Process notepad.exe')
  expect(text.argv[4]).not.toContain('setup')
  expect(text.stdin).toBe('C:\\p\\setup & go.bat')
  const show = openRun('windows', 'show', 'C:\\p\\tool.exe')
  expect(show.argv[4]).toContain("Start-Process explorer.exe -ArgumentList ('/select,\"'")
  expect(show.stdin).toBe('C:\\p\\tool.exe')
  expect(openRun('windows', 'open', 'C:\\p\\a.png')).toEqual({ argv: ['explorer.exe', 'C:\\p\\a.png'] })
  expect(openRun('wsl', 'text', '\\\\wsl.localhost\\Ubuntu\\p\\run.py').argv[4]).toContain('-Verb Edit')
  expect(openRun('wsl', 'show', '\\\\wsl.localhost\\Ubuntu\\p\\a.exe').argv[0]).toBe('explorer.exe')
  expect(openRun('mac', 'text', '/p/run.py')).toEqual({ argv: ['open', '-t', '/p/run.py'] })
})

test('the pane carries the monogram where the surface draws SVG, and the terminal its header alone', async ($, on) => {
  engine(on)
  await $.session.start({ source: 'startup', cwd: '/work/project' } as never)
  const desktop = await $.ui.mount({ plugin: 'handoffs', surface: 'desktop', ...PANE })
  expect((await desktop.find({ type: 'Svg' }))?.props.alt).toBe('Ghost Hat Studio')
  expect(await desktop.find({ type: 'Text', text: /GHOST HAT STUDIO/ })).toBeDefined()
  await desktop.unmount()
  const terminal = await $.ui.mount({ plugin: 'handoffs', surface: 'terminal', ...PANE })
  expect(await terminal.find({ type: 'Svg' })).toBeUndefined()
  expect(await terminal.find({ type: 'Text', text: /GHOST HAT STUDIO/ })).toBeDefined()
  await terminal.unmount()
})

test('the pane follows a light theme: no ground of its own, theme text, and the deeper accents', async ($, on) => {
  engine(on)
  on('config.list', () => ({ value: [{ key: 'theme', label: 'Theme', kind: 'choice', value: 'light', provider: { kind: 'engine' } }] }))
  await $.session.start({ source: 'startup', cwd: '/work/project' } as never)
  const pane = await $.ui.mount({ plugin: 'handoffs', surface: 'desktop', ...PANE })
  const header = await pane.find({ type: 'Text', text: /GHOST HAT STUDIO/ })
  expect(header?.props.color).toBe('#3A4A5E')
  expect(JSON.stringify(await pane.find({ type: 'Box' }))).not.toContain('backgroundColor')
  await pane.unmount()
})

test('the pane stays dark under a dark theme, with headings light enough to read', async ($, on) => {
  engine(on)
  on('config.list', () => ({ value: [{ key: 'theme', label: 'Theme', kind: 'choice', value: 'dark', provider: { kind: 'engine' } }] }))
  await $.session.start({ source: 'startup', cwd: '/work/project' } as never)
  const pane = await $.ui.mount({ plugin: 'handoffs', surface: 'terminal', ...PANE })
  expect((await pane.find({ type: 'Text', text: /GHOST HAT STUDIO/ }))?.props.color).toBe('#98ABC1')
  await pane.unmount()
  system.style = ''
})

test('switching the theme to light while the pane is open redraws it with the light accents', async ($, on) => {
  engine(on)
  let theme = 'dark'
  on('config.list', () => ({ value: [{ key: 'theme', label: 'Theme', kind: 'choice', value: theme, provider: { kind: 'engine' } }] }))
  on('config.set', ($, e) => { theme = String(e.value); return { value: e.value } })
  await $.session.start({ source: 'startup', cwd: '/work/project' } as never)
  const pane = await $.ui.mount({ plugin: 'handoffs', surface: 'terminal', ...PANE })
  expect((await pane.find({ type: 'Text', text: /GHOST HAT STUDIO/ }))?.props.color).toBe('#98ABC1')
  await $.config.set({ key: 'theme', value: 'light' } as never)
  expect((await pane.find({ type: 'Text', text: /GHOST HAT STUDIO/ }))?.props.color).toBe('#3A4A5E')
  await pane.unmount()
})

test('under the auto theme, the pane follows the system into dark mode without waiting for a redraw', async ($, on) => {
  const { clock } = engine(on)
  system.style = ''
  on('config.list', () => ({ value: [{ key: 'theme', label: 'Theme', kind: 'choice', value: 'auto', provider: { kind: 'engine' } }] }))
  await $.session.start({ source: 'startup', cwd: '/work/project' } as never)
  const pane = await $.ui.mount({ plugin: 'handoffs', surface: 'terminal', ...PANE })
  expect((await pane.find({ type: 'Text', text: /GHOST HAT STUDIO/ }))?.props.color).toBe('#3A4A5E')
  system.style = 'Dark\n'
  await clock.advance(5_000)
  expect((await pane.find({ type: 'Text', text: /GHOST HAT STUDIO/ }))?.props.color).toBe('#98ABC1')
  await pane.unmount()
  system.style = ''
})

test('outside fullscreen the pane says how to give it a column, and in fullscreen it does not', async ($, on) => {
  engine(on)
  await $.session.start({ source: 'startup', cwd: '/work/project' } as never)
  const inline = await $.ui.mount({ plugin: 'handoffs', surface: 'terminal', ...PANE, viewport: { columns: 120, rows: 40, isFullscreen: false } })
  expect(await inline.find({ type: 'Text', text: /\/tui fullscreen/ })).toBeDefined()
  await inline.unmount()
  const docked = await $.ui.mount({ plugin: 'handoffs', surface: 'terminal', ...PANE, viewport: { columns: 120, rows: 40, isFullscreen: true } })
  expect(await docked.find({ type: 'Text', text: /\/tui fullscreen/ })).toBeUndefined()
  await docked.unmount()
})

test('the handoff format reaches Claude in the system prompt, or with the first message when the host brings its own prompt', async ($, on) => {
  engine(on)
  on('prompt.context', ($, e) => ({ blocks: e.blocks }))
  await $.session.start({ source: 'startup', cwd: '/work/project' } as never)
  const composed = await $.prompt.compose({ model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [], sections: [] })
  expect(composed.sections.map(s => s.id)).toContain('handoffs:format')
  const context = await $.prompt.context({ blocks: [] } as never)
  expect(context.blocks.map(b => b.name)).not.toContain('handoffs')
})

test('a session started with its own system prompt still learns the handoff format', async ($, on) => {
  engine(on)
  on('prompt.context', ($, e) => ({ blocks: e.blocks }))
  await $.session.start({ source: 'startup', cwd: '/work/project' } as never)
  // `--system-prompt` and SDK hosts that replace the prompt: the engine composes no prompt, so prompt.compose never fires.
  const context = await $.prompt.context({ blocks: [{ name: 'currentDate', text: 'Today' }] } as never)
  const block = context.blocks.find(b => b.name === 'handoffs')
  expect(block?.text).toContain('```handoff')
  expect(context.blocks[0].name).toBe('currentDate')
})
