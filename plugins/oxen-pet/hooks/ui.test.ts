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
function stubEngine(on: On, clock?: MockClock) {
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
  on('session.usage', () => ({ value: usage }))
  on('agent.list', () => ({ value: [] }))
  on('fs.read', () => ({ value: JSON.stringify(BLOCK) }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['engine hint'] }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
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

test('the band draws the pet, and the hint line draws the HUD in its window', async ($, on) => {
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
  expect(String(reset.result)).toContain('The slime is back')
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
  expect(String(slime.result)).toContain('"name":"block"')

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

test('the desktop band draws the pet as an SVG, and the HUD under it with each bar as an SVG', async ($, on) => {
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
