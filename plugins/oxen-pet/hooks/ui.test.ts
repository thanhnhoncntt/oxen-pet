import { expect, mock, test } from 'claude-code/testing'
import type { On, SessionUsage } from 'claude-code'
import type { MockClock, TestBody } from 'claude-code/testing'

const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 100, scroll: { offset: 0, bodyRows: 20 }, view: {} } } as const
const HINT = { component: 'PromptHint', props: { isDraft: false, isWorking: false, hint: '⏵⏵ auto mode on' } } as const

const BLOCK = { name: 'block', sprite: ['ddddddd', 'ddddddd', 'ddddddd', 'ddddddd'], palette: { d: '#3d84f0' }, eyes: [[0, 1], [4, 1]] }
const CAT = { name: 'Mochi', sprite: ['k.....k', 'kkkkkkk', 'kwkkkwk', 'kkkkkkk'], palette: { k: '#e8a33d', w: '#fff4e0' }, eyes: [[0, 1], [4, 1]] }
const usage: SessionUsage = { startedAt: 0, context: { window: 200000, percent: 14 }, rateLimits: [{ kind: 'five_hour', percentUsed: 38 }] }

/**
 * Answers what the mod asks of Claude Code, and draws Claude Code's own hint line as one Text. Returns the mod's
 * store, kept in memory. A test that moves the clock makes it with `mock.clock` and passes it in.
 */
function stubEngine(on: On, clock?: MockClock, use: SessionUsage = usage) {
  const store = new Map<string, unknown>()
  if (!clock) {
    mock.clock(on)
  }
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.delete', (_$, e) => {
    store.delete(e.key)
    return { value: undefined }
  })
  on('session.start', (_$, e) => e)
  on('session.usage', () => ({ value: use }))
  on('agent.list', () => ({ value: [] }))
  // A file the test wrote under `file:<path>` reads as written; any other reads as BLOCK. Each path read is kept under `reads`.
  on('fs.read', (_$, e) => {
    store.set('reads', [...((store.get('reads') as string[] | undefined) ?? []), e.path])
    const file = store.get(`file:${e.path}`)
    return file === undefined ? { value: JSON.stringify(BLOCK) } : { value: String(file) }
  })
  on('fs.exists', (_$, e) => ({ value: store.has(`file:${e.path}`) }))
  on('fs.list', (_$, e) => {
    const dir = `file:${String(e.path).replace(/\/$/, '')}/`
    const names = [...store.keys()].filter(k => k.startsWith(dir) && !k.slice(dir.length).includes('/')).map(k => k.slice(dir.length))
    return { value: names.map(name => ({ name, kind: 'file', size: 0, mtimeMs: 0, isLink: false })) } as never
  })
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['engine hint'] }))
  on('ui.status', () => ({ value: undefined }))
  // The toasts shown, in order, under `toasts`.
  on('ui.toast', (_$, e) => {
    store.set('toasts', [...((store.get('toasts') as string[] | undefined) ?? []), e.text])
    return { value: undefined }
  })
  on('fs.write', (_$, e) => {
    store.set(`file:${e.path}`, e.text)
    return { value: undefined }
  })
  // /tmp is the one folder; `link:<path>` in the store plants a symbolic link there, to the path it holds.
  on('fs.stat', (_$, e) => {
    const at = (kind: 'file' | 'dir', isLink: boolean, real: string) => ({ value: { kind, size: 0, mtimeMs: 0, isLink, realPath: e.resolve ? real : undefined } })
    const link = store.get(`link:${e.path}`)
    if (typeof link === 'string') {
      return at('file', true, link)
    }
    if (store.has(`file:${e.path}`)) {
      return at('file', false, e.path)
    }
    if (e.path === '/tmp' || e.path === '/tmp/') {
      return at('dir', false, '/private/tmp')
    }
    return { deny: `ENOENT: ${e.path}` }
  })

  return store
}

test('the band draws the pet, and the hint line draws the stacked HUD in its window', { options: { hudLayout: 'stacked' } }, async ($, on) => {
  stubEngine(on)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })

  const band = await $.ui.mount({ plugin: 'oxen-pet', surface: 'terminal', ...BAND })
  const drawn = JSON.stringify(await band.drawn())
  expect(drawn).toContain('"key":"pet"')
  await band.unmount()

  const hint = await $.ui.mount({ plugin: 'oxen-pet', surface: 'terminal', ...HINT })
  const tree = JSON.stringify(await hint.drawn())
  expect(tree).toContain('▄▄▄')
  expect(tree).toContain('▀▀▀')
  expect(tree).toContain('♥ HP')
  await hint.unmount()
})

test('a theme with a scene draws the band across its width, with the ground in a row below the pet', async ($, on) => {
  stubEngine(on)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const scene = { ground: ['gg'], obstacles: [['gg', 'gg']] }
  await $.tool.call({ tool: 'mcp__oxen-pet__set_theme', theme: { ...BLOCK, palette: { ...BLOCK.palette, g: '#888888' }, scene } })

  const band = await $.ui.mount({ plugin: 'oxen-pet', surface: 'terminal', ...BAND })
  const drawn = JSON.stringify(await band.drawn())
  expect(drawn).toContain('"key":"pet"')
  expect(drawn).toContain('"key":"ground"')
  expect(drawn).toContain('"columns":99')
  await band.unmount()
})

test('set_theme draws and keeps a theme, notes what it repaired, and refuses one with no sprite', async ($, on) => {
  const store = stubEngine(on)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })

  const set = await $.tool.call({ tool: 'mcp__oxen-pet__set_theme', theme: CAT })
  expect(set.deny).toBeUndefined()
  expect(String(set.result)).toContain('The Mochi theme is on screen now')
  expect(store.get('theme')).toEqual(CAT)

  const refused = await $.tool.call({ tool: 'mcp__oxen-pet__set_theme', theme: { name: 'nothing' } })
  expect(refused.deny ?? refused.text).toContain('`sprite` is a list of text rows')
  expect(store.get('theme')).toEqual(CAT)

  const noted = await $.tool.call({ tool: 'mcp__oxen-pet__set_theme', theme: { ...CAT, palette: { k: '#e8a33d' } } })
  expect(String(noted.result)).toContain('"w" has no palette color, so it is drawn clear.')
  expect(String(noted.result)).toContain('stand, run, jump, think, cheer, and 18 faces')

  const reset = await $.tool.call({ tool: 'mcp__oxen-pet__set_theme', theme: null })
  expect(String(reset.result)).toContain('The default pet is back')
  expect(store.get('theme')).toBeUndefined()
})

test('set_theme with no theme sets the last preview, and refuses when there is none', async ($, on) => {
  const store = stubEngine(on)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })

  const none = await $.tool.call({ tool: 'mcp__oxen-pet__set_theme' })
  expect(none.deny ?? none.text).toContain('no preview_theme call')

  await $.tool.call({ tool: 'mcp__oxen-pet__preview_theme', theme: CAT, path: '/tmp/oxen-pet-preview-cat.html' })
  const set = await $.tool.call({ tool: 'mcp__oxen-pet__set_theme' })
  expect(String(set.result)).toContain('The Mochi theme is on screen now')
  expect(store.get('theme')).toEqual(CAT)
})

test('get_theme returns the kept theme, or the slime\'s when none is kept', async ($, on) => {
  stubEngine(on)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })

  const slime = await $.tool.call({ tool: 'mcp__oxen-pet__get_theme' })
  expect(String(slime.result)).toContain('No theme is kept')
  expect(String(slime.result)).toContain('"name": "block"')

  await $.tool.call({ tool: 'mcp__oxen-pet__set_theme', theme: CAT })
  const kept = await $.tool.call({ tool: 'mcp__oxen-pet__get_theme' })
  expect(String(kept.result)).toContain('"name": "Mochi"')
})

test('the settings hide the HUD and the status line', { options: { hud: false, statusLine: false } }, async ($, on) => {
  stubEngine(on)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })

  const band = await $.ui.mount({ plugin: 'oxen-pet', surface: 'terminal', ...BAND })
  const drawn = JSON.stringify(await band.drawn())
  expect(drawn).toContain('"key":"pet"')
  expect(drawn).not.toContain('›')
  await band.unmount()

  const hint = await $.ui.mount({ plugin: 'oxen-pet', surface: 'terminal', ...HINT })
  expect(JSON.stringify(await hint.drawn())).not.toContain('♥ HP')
  await hint.unmount()
})

test('preview_theme writes the preview and leaves the pet on screen alone', async ($, on) => {
  const store = stubEngine(on)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })

  const wrote = await $.tool.call({ tool: 'mcp__oxen-pet__preview_theme', theme: CAT, path: '/tmp/oxen-pet-preview-mochi.html' })
  expect(String(wrote.result)).toContain('Wrote the preview of Mochi to /tmp/oxen-pet-preview-mochi.html')
  const page = String(store.get('file:/tmp/oxen-pet-preview-mochi.html'))
  for (const part of ['<title>Mochi: preview</title>', 'Motions', 'Faces', 'Frames', 'A subagent starts']) {
    expect(page).toContain(part)
  }
  expect(store.get('theme')).toBeUndefined()

  const nowhere = await $.tool.call({ tool: 'mcp__oxen-pet__preview_theme', theme: CAT })
  expect(nowhere.deny ?? nowhere.text).toContain('`path` is the HTML file to write')
})

test('preview_theme refuses a path outside oxen-pet-preview*.html and writes nothing', async ($, on) => {
  const store = stubEngine(on)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })

  for (const path of ['/Users/me/.zshrc', '/tmp/a/../../Users/me/oxen-pet-preview.html', 'oxen-pet-preview.html']) {
    const refused = await $.tool.call({ tool: 'mcp__oxen-pet__preview_theme', theme: CAT, path })
    expect(refused.deny ?? refused.text).toContain('No preview was written')
    expect(store.get(`file:${path}`)).toBeUndefined()
  }
})

test('preview_theme refuses a symbolic link planted at an allowed path, and writes nothing', async ($, on) => {
  const store = stubEngine(on)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  store.set('link:/tmp/oxen-pet-preview-evil.html', '/Users/me/.zshrc')

  const refused = await $.tool.call({ tool: 'mcp__oxen-pet__preview_theme', theme: CAT, path: '/tmp/oxen-pet-preview-evil.html' })
  expect(refused.deny ?? refused.text).toContain('symbolic link')
  expect(store.get('file:/tmp/oxen-pet-preview-evil.html')).toBeUndefined()
  expect(store.get('file:/Users/me/.zshrc')).toBeUndefined()
})

/** The HUD as drawn now, as one string. */
async function hudText($: Parameters<TestBody>[0]) {
  const hint = await $.ui.mount({ plugin: 'oxen-pet', surface: 'terminal', ...HINT })
  const tree = JSON.stringify(await hint.drawn())
  await hint.unmount()
  return tree
}

const TURN = { turnId: 't1', answer: 'hi', durationMs: 10, isAborted: false, reason: 'answer' } as const

test('the HUD counts the prompt cache down from the last main turn, and a subagent turn does not warm it', { options: { cacheTtl: '5m' } }, async ($, on) => {
  const clock = mock.clock(on)
  stubEngine(on, clock)
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  expect(await hudText($)).not.toContain('cache')

  await $.turn.complete(TURN as never)
  await clock.advance(2 * 60000)
  expect(await hudText($)).toContain('cache 3m')

  await $.turn.complete({ ...TURN, turnId: 't2', agentId: 'a1' } as never)
  await clock.advance(3 * 60000)
  expect(await hudText($)).toContain('cache cold')
})

test('the cache timer turned off shows nothing after a turn', { options: { cacheTtl: 'off' } }, async ($, on) => {
  stubEngine(on)
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await $.turn.complete(TURN as never)
  const tree = await hudText($)
  expect(tree).toContain('♥ HP')
  expect(tree).not.toContain('cache')
})

test('the desktop band draws the pet as an SVG, and the stacked HUD under it with each bar as an SVG', { options: { hudLayout: 'stacked' } }, async ($, on) => {
  stubEngine(on)
  await $.session.start({ cwd: '/tmp', surface: 'desktop', isInteractive: true })

  const band = await $.ui.mount({ plugin: 'oxen-pet', surface: 'desktop', ...BAND })
  const drawn = JSON.stringify(await band.drawn())
  expect(drawn).toContain('"alt":"block, idle"')
  expect(drawn).toContain('♥ HP')
  expect(drawn).toContain('✦ MP')
  expect(drawn).toContain('"alt":"HP bar, 86% left"')
  expect(drawn).toContain('"borderStyle":"round"')
  expect(drawn).not.toContain('Raster')
  await band.unmount()

  // The hint line under the prompt stays Claude Code's own on the desktop, so the HUD shows once.
  const hint = await $.ui.mount({ plugin: 'oxen-pet', surface: 'desktop', ...HINT })
  expect(JSON.stringify(await hint.drawn())).not.toContain('♥ HP')
  await hint.unmount()
})

test('the desktop band draws a scene as one SVG with the ground, and the HUD setting hides its HUD', { options: { hud: false } }, async ($, on) => {
  stubEngine(on)
  await $.session.start({ cwd: '/tmp', surface: 'desktop', isInteractive: true })
  const scene = { ground: ['gg'], obstacles: [['gg', 'gg']] }
  await $.tool.call({ tool: 'mcp__oxen-pet__set_theme', theme: { ...BLOCK, palette: { ...BLOCK.palette, g: '#888888' }, scene } })

  const band = await $.ui.mount({ plugin: 'oxen-pet', surface: 'desktop', ...BAND })
  const drawn = JSON.stringify(await band.drawn())
  expect(drawn).toContain('"alt":"block, idle, in its scene"')
  expect(drawn).toContain('viewBox=\\"0 0 99 22\\"')
  expect(drawn).not.toContain('♥ HP')
  await band.unmount()
})

/** Makes Claude Code's own verdict `decision`, and answers the shield's question with `answer`; undefined dismisses it. Returns the questions asked. */
function stubGuard(on: Parameters<TestBody>[1], decision: 'allow' | 'ask' | 'deny', answer: string | undefined) {
  const asked: string[] = []
  on('tool.check', () => ({ decision, reason: 'the mode decided' }))
  on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => {
    const question = (e as unknown as { questions: { question: string }[] }).questions[0]!.question
    asked.push(question)
    if (answer === undefined) {
      return { deny: 'dismissed' }
    }
    return { result: { questions: (e as unknown as { questions: unknown[] }).questions, answers: { [question]: answer } } } as never
  })
  return asked
}

const RISKY = { tool: 'Bash', input: { command: 'rm -rf /tmp/build' }, tool_use_id: 'toolu_1' } as never

test('the shield asks before a destructive command runs unasked, names what it deletes, and runs it only on "Run it"', async ($, on) => {
  stubEngine(on)
  const asked = stubGuard(on, 'allow', 'Run it')
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })

  const verdict = await $.tool.check(RISKY)
  expect(verdict.decision).toBe('allow')
  expect(asked).toHaveLength(1)
  expect(asked[0]).toContain('`rm -rf /tmp/build` deletes files and folders for good')
  expect(asked[0]).toContain('/tmp/build: not there')
})

test('the shield blocks on "Block it", and when no one answers', async ($, on) => {
  stubEngine(on)
  stubGuard(on, 'allow', 'Block it')
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const blocked = await $.tool.check(RISKY)
  expect([blocked.decision, blocked.reason]).toEqual(['deny', expect.stringContaining('The user blocked')])

  const band = await $.ui.mount({ plugin: 'oxen-pet', surface: 'terminal', ...BAND })
  expect(JSON.stringify(await band.drawn())).toContain('shield up: blocked it')
  await band.unmount()
})

test('with no one to answer, the shield blocks and names the setting that turns it off', async ($, on) => {
  stubEngine(on)
  stubGuard(on, 'allow', undefined)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const verdict = await $.tool.check(RISKY)
  expect(verdict.decision).toBe('deny')
  expect(verdict.reason).toContain('Shield')
})

test("the shield leaves Claude Code's own ask and deny alone, adding what the command deletes to an ask", async ($, on) => {
  stubEngine(on)
  const asked = stubGuard(on, 'ask', 'Run it')
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const verdict = await $.tool.check(RISKY)
  expect(verdict.decision).toBe('ask')
  expect(verdict.reason).toContain('deletes files and folders for good')
  expect(asked).toHaveLength(0)
})

test('the shield passes a safe command, a query, and everything when turned off', { options: { guard: false } }, async ($, on) => {
  stubEngine(on)
  const asked = stubGuard(on, 'allow', 'Block it')
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  expect((await $.tool.check(RISKY)).decision).toBe('allow')
  expect(asked).toHaveLength(0)
})

test('a query about a destructive command never opens a dialog', async ($, on) => {
  stubEngine(on)
  const asked = stubGuard(on, 'allow', 'Block it')
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  expect((await $.tool.check({ tool: 'Bash', input: { command: 'rm -rf /tmp/build' } })).decision).toBe('allow')
  expect((await $.tool.check({ tool: 'Bash', input: { command: 'ls' }, tool_use_id: 'toolu_2' } as never)).decision).toBe('allow')
  expect(asked).toHaveLength(0)
})

/** Makes each Bash call answer as a test run that fails while `failing.now` is true, and passes after. */
function stubTests(on: Parameters<TestBody>[1]) {
  const failing = { now: true }
  on('tool.call', { tool: 'Bash' }, () => (failing.now ? { isError: true, result: 'Exit code 1', text: 'Exit code 1' } : { result: { stdout: 'ok', stderr: '', interrupted: false } }) as never)
  return failing
}

async function bandText($: Parameters<TestBody>[0], surface: 'terminal' | 'desktop' = 'terminal') {
  const band = await $.ui.mount({ plugin: 'oxen-pet', surface, ...BAND })
  const tree = JSON.stringify(await band.drawn())
  await band.unmount()
  return tree
}

test('a failed test run brings the boss into the band, and the next passing run defeats it', async ($, on) => {
  const clock = mock.clock(on)
  stubEngine(on, clock)
  const failing = stubTests(on)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  expect(await bandText($)).not.toContain('"key":"boss"')

  await $.tool.call({ tool: 'Bash', command: 'npm test' } as never)
  expect(await bandText($)).toContain('"key":"boss"')
  expect(await bandText($, 'desktop')).toContain('"alt":"a bug boss, 1 hit"')

  // Another command that fails is not a test run.
  await $.tool.call({ tool: 'Bash', command: 'npm run build' } as never)
  expect(await bandText($, 'desktop')).toContain('1 hit')

  failing.now = false
  await $.tool.call({ tool: 'Bash', command: 'npm test' } as never)
  expect(await bandText($)).toContain('"key":"boss"')
  await clock.advance(2000)
  expect(await bandText($)).not.toContain('"key":"boss"')
})

test('the boss stays away when turned off', { options: { boss: false } }, async ($, on) => {
  stubEngine(on)
  stubTests(on)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'npm test' } as never)
  expect(await bandText($)).not.toContain('"key":"boss"')
})

test('in a scene the boss stands on the ground at the right of the band', async ($, on) => {
  stubEngine(on)
  stubTests(on)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const scene = { ground: ['gg'], obstacles: [['gg', 'gg']] }
  await $.tool.call({ tool: 'mcp__oxen-pet__set_theme', theme: { ...BLOCK, palette: { ...BLOCK.palette, g: '#888888' }, scene } })
  const before = await bandText($)
  await $.tool.call({ tool: 'Bash', command: 'pytest' } as never)
  const after = await bandText($)
  expect(after).not.toEqual(before)
  expect(await bandText($, 'desktop')).toContain('#7c3aed')
})

test('as the context runs low the pet says so and a toast suggests /compact, once', async ($, on) => {
  const clock = mock.clock(on)
  const store = stubEngine(on, clock, { ...usage, context: { window: 200000, percent: 85 } })
  const toasts = () => (store.get('toasts') as string[] | undefined) ?? []
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await clock.advance(2000)
  expect(toasts().filter(t => t.includes('context left'))).toHaveLength(1)
  expect(await bandText($)).toContain('context almost full')
  await clock.advance(10000)
  expect(toasts().filter(t => t.includes('context left'))).toHaveLength(1)
  expect(await bandText($)).not.toContain('context almost full')
})

const PANE = { component: 'Pane', props: { title: 'oxen-pet', isFocused: false, bodyColumns: 70, placement: 'inline', scroll: { offset: 0, bodyRows: 12 }, view: {} } } as const

/** Answers $.ui.open as a surface that places every pane, and $.ui.panes with the panes open. Returns the ids opened. */
function stubPanes(on: Parameters<TestBody>[1]) {
  const open: string[] = []
  on('ui.open', (_$, e) => {
    open.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', (_$, e) => {
    open.splice(open.indexOf(e.id), 1)
    return { value: undefined }
  })
  on('ui.panes', () => ({ value: open.map(id => ({ id, title: id, isShown: true, isFocused: false, isPlaced: true })) }) as never)
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  return open
}

test('/pet opens a pane with what the session did, and closes it when run again', async ($, on) => {
  stubEngine(on)
  const open = stubPanes(on)
  stubTests(on)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'npm test' } as never)

  await $.command.run({ command: 'pet', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } } as never)
  expect(open).toEqual(['pet'])
  const pane = await $.ui.mount({ plugin: 'oxen-pet', surface: 'terminal', requestId: 'pet', ...PANE })
  const tree = JSON.stringify(await pane.drawn())
  for (const part of ['Session', '1 call: 1 bash · 1 failed', '1 run: 0 passed · 1 failed', '"key":"face"']) {
    expect(tree).toContain(part)
  }
  await pane.unmount()

  await $.command.run({ command: 'pet', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } } as never)
  expect(open).toEqual([])
})

test('the /pet pane draws its pet as an SVG where there is no Raster, and leaves other panes alone', async ($, on) => {
  stubEngine(on)
  stubPanes(on)
  await $.session.start({ cwd: '/tmp', surface: 'mobile', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'oxen-pet', surface: 'mobile', requestId: 'pet', ...PANE })
  const tree = JSON.stringify(await pane.drawn())
  expect(tree).toContain('"type":"Svg"')
  expect(tree).not.toContain('Raster')
  await pane.unmount()

  const other = await $.ui.mount({ plugin: 'oxen-pet', surface: 'terminal', requestId: 'someone-else', ...PANE })
  expect(JSON.stringify(await other.drawn())).toContain('engine hint')
  await other.unmount()
})

test('the row layout draws the bars side by side in one row, and the compact HUD on a terminal too narrow for it', { options: { hudLayout: 'row' } }, async ($, on) => {
  stubEngine(on)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })

  const wide = await $.ui.mount({ plugin: 'oxen-pet', surface: 'terminal', viewport: { columns: 160, rows: 40 }, ...HINT })
  const tree = JSON.stringify(await wide.drawn())
  expect(tree).toContain('"key":"row"')
  expect(tree).toContain(' │ ')
  expect(tree).toContain('♥ HP')
  // One line: no window edges above or below it.
  expect(tree).not.toContain('▄▄▄')
  expect(tree).not.toContain('▀▀▀')
  await wide.unmount()

  const narrow = await $.ui.mount({ plugin: 'oxen-pet', surface: 'terminal', viewport: { columns: 40, rows: 40 }, ...HINT })
  const compact = JSON.stringify(await narrow.drawn())
  expect(compact).not.toContain('"key":"row"')
  expect(compact).toContain('"key":"compact"')
  await narrow.unmount()
})

test('the stacked layout draws its window where it fits, and the compact HUD where it does not', { options: { hudLayout: 'stacked' } }, async ($, on) => {
  stubEngine(on)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const fits = await $.ui.mount({ plugin: 'oxen-pet', surface: 'terminal', viewport: { columns: 70, rows: 40 }, ...HINT })
  expect(JSON.stringify(await fits.drawn())).toContain('▄▄▄')
  await fits.unmount()
  const narrow = await $.ui.mount({ plugin: 'oxen-pet', surface: 'terminal', viewport: { columns: 38, rows: 40 }, ...HINT })
  const compact = JSON.stringify(await narrow.drawn())
  expect(compact).toContain('"key":"compact"')
  expect(compact).not.toContain('▄▄▄')
  await narrow.unmount()
})

test('a terminal narrower than the HUD window, such as a split pane, gets one bar a line with no window, cut rather than wrapped', async ($, on) => {
  const clock = mock.clock(on)
  stubEngine(on, clock, { ...usage, rateLimits: [{ kind: 'five_hour', percentUsed: 38, resetsAt: new Date((await clock.now()) + 3 * 3600000).toISOString() }] } as SessionUsage)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })

  const narrow = await $.ui.mount({ plugin: 'oxen-pet', surface: 'terminal', viewport: { columns: 38, rows: 40 }, ...HINT })
  const compact = JSON.stringify(await narrow.drawn())
  expect(compact).toContain('"key":"compact"')
  expect(compact).toContain('♥ HP')
  expect(compact).toContain('"columns":10')
  // The detail is the one part that may give way, cut at the edge.
  expect(compact).toContain('"wrap":"truncate"},"children":["  3h00m"]')
  // Only the text may give way: the label, the bar and the reading keep their width, so none of them breaks a line.
  type Node = { type: string; props: Record<string, unknown>; children: Node[] }
  const rows = (JSON.parse(compact) as Node).children.find(c => c.props.key === 'compact')!.children
  for (const row of rows) {
    const fixed = row.children[0]!
    expect([fixed.props.key, fixed.props.flexShrink, fixed.children.map(c => c.type)]).toEqual(['fixed', 0, ['Text', 'Raster', 'Text']])
  }
  expect(compact).not.toContain('▄▄▄')
  expect(compact).not.toContain('▀▀▀')
  await narrow.unmount()

  const tiny = await $.ui.mount({ plugin: 'oxen-pet', surface: 'terminal', viewport: { columns: 15, rows: 40 }, ...HINT })
  const none = JSON.stringify(await tiny.drawn())
  expect(none).not.toContain('♥ HP')
  expect(none).toContain('engine hint')
  await tiny.unmount()
})

test('on the desktop the row layout lays the HUD\'s bars side by side too', { options: { hudLayout: 'row' } }, async ($, on) => {
  stubEngine(on)
  await $.session.start({ cwd: '/tmp', surface: 'desktop', isInteractive: true })
  const tree = await bandText($, 'desktop')
  expect(tree).toContain('"key":"hud","flexDirection":"row"')
  expect(tree).not.toContain('"borderStyle"')
  expect(tree).toContain(' │ ')
})

const ZORO = { ...BLOCK, name: 'Zoro', palette: { d: '#3fae4f' } }
const PETS = '/home/me/pets'
const run = (args: string) => ({ command: 'pet', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } }) as never

test('with no theme kept or chosen, the session starts with Luffy, from the plugin\'s own assets', async ($, on) => {
  const store = stubEngine(on)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await bandText($)
  expect(((store.get('reads') as string[]) ?? []).some(p => p.endsWith('/assets/luffy.json'))).toBe(true)
})

test('the Theme setting starts the session with a theme from the custom folder', { options: { theme: 'zoro', customDir: PETS } }, async ($, on) => {
  const store = stubEngine(on)
  store.set(`file:${PETS}/zoro.theme.json`, JSON.stringify(ZORO))
  await $.session.start({ cwd: '/tmp', surface: 'desktop', isInteractive: true })
  expect(await bandText($, 'desktop')).toContain('"alt":"Zoro, idle"')
})

test('/pet theme lists the pets, and /pet theme <name> puts one on screen and keeps it for later sessions', { options: { customDir: PETS } }, async ($, on) => {
  const store = stubEngine(on)
  stubPanes(on)
  store.set(`file:${PETS}/zoro.theme.json`, JSON.stringify(ZORO))
  await $.session.start({ cwd: '/tmp', surface: 'desktop', isInteractive: true })

  const listed = await $.command.run(run('theme'))
  expect(listed.text).toContain('Yours: zoro')
  expect(listed.text).toContain(PETS)

  const chosen = await $.command.run(run('theme zoro'))
  expect(chosen.text).toContain('Zoro is on screen')
  expect(store.get('chosen')).toBe('zoro')
  expect(await bandText($, 'desktop')).toContain('"alt":"Zoro, idle"')

  const missing = await $.command.run(run('theme nami'))
  expect(missing.text).toContain('No theme named nami')
  expect(store.get('chosen')).toBe('zoro')
  const bad = await $.command.run(run('theme ../x'))
  expect(bad.text).toContain('No theme named ../x')
})

test('a chosen theme replaces one set_theme kept, and set_theme null brings the default back', { options: { customDir: PETS } }, async ($, on) => {
  const store = stubEngine(on)
  stubPanes(on)
  store.set(`file:${PETS}/zoro.theme.json`, JSON.stringify(ZORO))
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'mcp__oxen-pet__set_theme', theme: CAT })
  await $.command.run(run('theme zoro'))
  expect(store.get('theme')).toBeUndefined()

  await $.tool.call({ tool: 'mcp__oxen-pet__set_theme', theme: CAT })
  expect(store.get('chosen')).toBeUndefined()
  const reset = await $.tool.call({ tool: 'mcp__oxen-pet__set_theme', theme: null })
  expect(String(reset.result)).toContain('The default pet is back')
  expect([store.get('theme'), store.get('chosen')]).toEqual([undefined, undefined])
})

test('a custom theme that no longer reads gives way to the default, with a toast', { options: { theme: 'broken', customDir: PETS } }, async ($, on) => {
  const store = stubEngine(on)
  store.set(`file:${PETS}/broken.theme.json`, '{ "sprite": ')
  await $.session.start({ cwd: '/tmp', surface: 'desktop', isInteractive: true })
  expect(await bandText($, 'desktop')).toContain('"alt":"block, idle"')
  expect(((store.get('toasts') as string[]) ?? []).join()).toContain('broken')
})

test('the HUD is a row by default, where the terminal has the room', async ($, on) => {
  stubEngine(on)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const hint = await $.ui.mount({ plugin: 'oxen-pet', surface: 'terminal', viewport: { columns: 120, rows: 40 }, ...HINT })
  expect(JSON.stringify(await hint.drawn())).toContain('"key":"row"')
  await hint.unmount()
})

test('HUD layout stacked keeps one bar per line', { options: { hudLayout: 'stacked' } }, async ($, on) => {
  stubEngine(on)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const hint = await $.ui.mount({ plugin: 'oxen-pet', surface: 'terminal', viewport: { columns: 120, rows: 40 }, ...HINT })
  const tree = JSON.stringify(await hint.drawn())
  expect(tree).not.toContain('"key":"row"')
  expect(tree).toContain('"key":"mp"')
  await hint.unmount()
})
