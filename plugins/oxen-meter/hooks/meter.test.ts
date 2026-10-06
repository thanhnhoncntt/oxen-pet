import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

type On = Parameters<TestBody>[1]
type Engine = Parameters<TestBody>[0]

const PANE = { component: 'Pane', props: { title: 'oxen-meter', isFocused: false, bodyColumns: 90, placement: 'inline', scroll: { offset: 0, bodyRows: 14 }, view: {} } } as const
const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } } as const
const USAGE = { input_tokens: 10, output_tokens: 400, cache_read_input_tokens: 90000, cache_creation_input_tokens: 3000, model: 'claude-opus-5-5' }
const STEP = { turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 4 }
const SUMMARY = { role: 'user' as const, text: 'summary', toolUses: [] }

const SID = '2f6c1d0a-8e1b-4c55-9a39-0c0f6f9e6b11'

/**
 * A file system in memory: folders, files with their times, and symbolic links to another path. `/home/me` is there
 * to start with; a write creates the folders above it, as `$.fs.write` does.
 */
function stubFs(on: On) {
  const dirs = new Set(['/', '/home', '/home/me'])
  const files = new Map<string, { text: string; mtimeMs: number }>()
  const links = new Map<string, string>()
  const writes: string[] = []
  const parentOf = (p: string) => p.slice(0, p.lastIndexOf('/')) || '/'
  on('fs.stat', (_$, e) => {
    const at = (kind: 'file' | 'dir', isLink: boolean, real: string, mtimeMs = 0) => ({ value: { kind, size: 0, mtimeMs, isLink, realPath: e.resolve ? real : undefined } })
    const link = links.get(e.path)
    if (link !== undefined) {
      return at(dirs.has(link) ? 'dir' : 'file', true, link)
    }
    const file = files.get(e.path)
    if (file) {
      return at('file', false, e.path, file.mtimeMs)
    }
    return dirs.has(e.path) ? at('dir', false, e.path) : { deny: `ENOENT: ${e.path}` }
  })
  on('fs.write', (_$, e) => {
    for (let d = parentOf(e.path); !dirs.has(d); d = parentOf(d)) {
      dirs.add(d)
    }
    files.set(e.path, { text: e.text, mtimeMs: 0 })
    writes.push(e.path)
    return { value: undefined }
  })
  on('fs.read', (_$, e) => {
    if (e.path.endsWith('/.claude-plugin/plugin.json')) {
      return { value: '{"name":"oxen-meter","version":"0.1.0"}' }
    }
    const file = files.get(e.path)
    return file ? { value: file.text } : { deny: `ENOENT: ${e.path}` }
  })
  on('fs.list', (_$, e) => {
    const names = [...files.keys()].filter(f => parentOf(f) === e.path)
    return { value: names.map(f => ({ name: f.slice(e.path.length + 1), kind: 'file', size: files.get(f)!.text.length, mtimeMs: files.get(f)!.mtimeMs, isLink: false })) } as never
  })
  return { dirs, files, links, writes }
}

/** Answers what the meter asks of Claude Code: panes that are always placed, an agent list the test fills, toasts it keeps. */
function stubEngine(on: On, placed = true) {
  const clock = mock.clock(on)
  const store = new Map<string, unknown>()
  const session = { id: SID }
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('session.id', () => ({ value: session.id }))
  on('session.root', () => ({ value: '/home/me/src/app' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000 }, rateLimits: [], cost: { usd: 1.5 } } }) as never)
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  const open: string[] = []
  const agents: { id: string; status: string; type: string; description: string; name?: string }[] = []
  const toasts: string[] = []
  on('session.start', (_$, e) => e)
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.open', (_$, e) => {
    if (placed) {
      open.push(e.id)
    }
    return { value: { isPlaced: placed } } as never
  })
  on('ui.close', (_$, e) => {
    open.splice(open.indexOf(e.id), 1)
    return { value: undefined }
  })
  on('ui.panes', () => ({ value: open.map(id => ({ id, title: id, isShown: true, isFocused: false, isPlaced: true })) }) as never)
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['engine'] }))
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('agent.list', () => ({ value: agents }) as never)
  on('classic.SubagentStart', () => ({}) as never)
  on('classic.SubagentStop', () => ({}) as never)
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('session.send', () => ({ isDelivered: true }) as never)
  on('classic.SessionStart', () => ({}) as never)
  on('classic.PostModelSwitch', () => ({}) as never)
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  return { open, agents, toasts, clock, store, session }
}

/** Answers each model step as the API would, streaming one text chunk; the inputs the engine was sent land in `sent`. */
function stubModel(on: On, sent: unknown[], usage: unknown = USAGE) {
  on('turn.step', async function* (_$, e) {
    sent.push(e)
    yield { kind: 'text', index: 0, text: 'hi' }
    return { turnId: e.turnId, index: e.index, answer: 'hi', toolUses: [{ name: 'Read', input: {} }], stopReason: 'tool_use', usage } as never
  })
}

async function runStep($: Engine, e: Record<string, unknown>) {
  const stream = $.turn.step(e as never)
  const chunks: unknown[] = []
  for (let r = await stream.next(); ; r = await stream.next()) {
    if (r.done) {
      return { chunks, result: r.value }
    }
    chunks.push(r.value)
  }
}

/** Opens /meter and returns the pane as drawn on `surface`, as one string. */
async function paneText($: Engine, surface: 'terminal' | 'desktop' = 'terminal') {
  const pane = await $.ui.mount({ plugin: 'oxen-meter', surface, requestId: 'meter', ...PANE })
  const tree = JSON.stringify(await pane.drawn())
  await pane.unmount()
  return tree
}

test('a model step reaches the engine untouched, streams through, and is measured', async ($, on) => {
  stubEngine(on)
  const sent: unknown[] = []
  stubModel(on, sent)
  await $.session.start({ cwd: '/tmp/app', surface: 'terminal', isInteractive: true })

  const input = { ...STEP, effort: 'high' }
  const { chunks, result } = await runStep($, input)
  expect(sent).toEqual([input])
  expect(chunks).toEqual([{ kind: 'text', index: 0, text: 'hi' }])
  expect(result).toMatchObject({ answer: 'hi', usage: USAGE })

  for (const surface of ['terminal', 'desktop'] as const) {
    const tree = await paneText($, surface)
    expect(tree).toContain('hit 97%')
    expect(tree).toContain('opus-5-5 · ctx 93K · read 0m ago · warm ~1h00m')
    expect(tree).toContain('turn.step')
    expect(tree).not.toContain('Raster')
  }
})

test('/meter opens the pane and closes it when run again', async ($, on) => {
  const { open } = stubEngine(on)
  await $.session.start({ cwd: '/tmp/app', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'meter', args: '', ...RUN } as never)
  expect(open).toEqual(['meter'])
  await $.command.run({ command: 'meter', args: '', ...RUN } as never)
  expect(open).toEqual([])
})

test('where no pane can be placed, /meter prints its rows', async ($, on) => {
  stubEngine(on, false)
  stubModel(on, [])
  await $.session.start({ cwd: '/tmp/app', surface: 'terminal', isInteractive: true })
  await runStep($, STEP)
  const out = await $.command.run({ command: 'meter', args: '', ...RUN } as never)
  expect(String(out.text)).toContain('Cache: hit 97%')
})

test('a Codex call, an Agent call and a commit are recorded by name and count, never by their command or prompt', async ($, on) => {
  stubEngine(on)
  stubModel(on, [])
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: 'done', stderr: '', interrupted: false, backgroundTaskId: 'bg1' } }) as never)
  on('tool.call', { tool: 'Agent' }, () => ({
    result: {
      status: 'completed', agentId: 'agent-9d1e', agentType: 'Explore', resolvedModel: 'claude-sonnet-5-5', content: [], totalToolUseCount: 3, totalDurationMs: 9000, totalTokens: 41000, prompt: 'look at secret-plan.md',
      usage: { input_tokens: 1, output_tokens: 2, cache_creation_input_tokens: 9000, cache_read_input_tokens: 30000, server_tool_use: null, service_tier: null, cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 9000 } },
    },
  }) as never)
  await $.session.start({ cwd: '/tmp/app', surface: 'terminal', isInteractive: true })
  await runStep($, STEP)

  await $.tool.call({ tool: 'Bash', command: 'node /x/codex-companion.mjs task --write "fix secret-plan.md"', run_in_background: true } as never)
  await $.tool.call({ tool: 'Bash', command: 'git commit -m "secret message"' } as never)
  await $.tool.call({ tool: 'Bash', command: 'ls secret-dir' } as never)
  await $.tool.call({ tool: 'Agent', description: 'Find it', prompt: 'look at secret-plan.md', subagent_type: 'Explore' } as never)

  const tree = await paneText($)
  expect(tree).toContain('1 Agent · 1 Codex (1 background)')
  expect(tree).toContain('1 commit')
  expect(tree).not.toContain('secret')
})

test('a subagent named at its start shows by its type while it runs', async ($, on) => {
  const { agents } = stubEngine(on)
  stubModel(on, [])
  await $.session.start({ cwd: '/tmp/app', surface: 'terminal', isInteractive: true })
  await $.classic.SubagentStart({ agent_id: 'agent-7f3a', agent_type: 'Explore' })
  agents.push({ id: 'agent-7f3a', status: 'running', type: 'Explore', description: 'Find it' })
  await runStep($, { ...STEP, agentId: 'agent-7f3a' })
  expect(await paneText($)).toContain('Explore 7f3a')
})

test('a compaction passes through untouched and is recorded with its sizes', async ($, on) => {
  stubEngine(on)
  stubModel(on, [])
  const seen: unknown[] = []
  on('session.compact', (_$, e) => {
    seen.push(e)
    return { messages: [SUMMARY], tokensBefore: 150000, tokensAfter: 20000 }
  })
  await $.session.start({ cwd: '/tmp/app', surface: 'terminal', isInteractive: true })
  await runStep($, STEP)
  const compaction = { trigger: 'manual', messages: [SUMMARY, SUMMARY] }
  const result = await $.session.compact(compaction as never)
  expect(seen).toEqual([compaction])
  expect(result).toMatchObject({ tokensBefore: 150000, tokensAfter: 20000 })
  expect(await paneText($)).toContain('1: 150K → 20K')
})

const DATA = { options: { dataDir: '/home/me/meter' } }
const TURN = { turnId: 't1', answer: 'secret answer', durationMs: 10, isAborted: false, reason: 'answer' } as const

test('a step writes nothing; after a main turn ends the timer writes the session through the guard, with no prompt or answer in it', DATA, async ($, on) => {
  const { clock } = stubEngine(on)
  const fs = stubFs(on)
  stubModel(on, [])
  await $.session.start({ cwd: '/home/me/src/app', surface: 'terminal', isInteractive: true })
  await runStep($, STEP)
  await $.turn.complete(TURN as never)
  expect(fs.writes).toEqual([])

  await clock.advance(15000)
  const path = `/home/me/meter/sessions/${SID}.json`
  expect(fs.writes).toEqual([path])
  const text = fs.files.get(path)!.text
  const file = JSON.parse(text)
  expect(file).toMatchObject({ v: 1, sid: SID, version: '0.1.0', costUsd: 1.5, groups: { 'main||claude-opus-5-5': { steps: 1 } } })
  expect(file.project).toMatch(/^[0-9a-f]{12}$/)
  expect(text).not.toContain('secret')
  expect(text).not.toContain('app')
  expect(await paneText($)).toContain('saved 0m ago to /home/me/meter/sessions')

  await clock.advance(15000)
  expect(fs.writes.length).toBe(1)
})

test('a symbolic link in the data folder stops the write, and the pane says why', DATA, async ($, on) => {
  const { clock } = stubEngine(on)
  const fs = stubFs(on)
  fs.dirs.add('/home/me/meter')
  fs.dirs.add('/etc')
  fs.links.set('/home/me/meter/sessions', '/etc')
  stubModel(on, [])
  await $.session.start({ cwd: '/home/me/src/app', surface: 'terminal', isInteractive: true })
  await runStep($, STEP)
  await $.turn.complete(TURN as never)
  await clock.advance(15000)
  expect(fs.writes).toEqual([])
  expect(await paneText($)).toContain('not saved: the sessions folder is a symbolic link.')
})

test('with no data folder nothing is written, and the pane says how to set one', async ($, on) => {
  const { clock } = stubEngine(on)
  const fs = stubFs(on)
  stubModel(on, [])
  await $.session.start({ cwd: '/home/me/src/app', surface: 'terminal', isInteractive: true })
  await runStep($, STEP)
  await $.turn.complete(TURN as never)
  await clock.advance(15000)
  expect(fs.writes).toEqual([])
  expect(await paneText($)).toContain('set Data folder')
})

test('a reload, or a resumed session, goes on from the session\'s file', DATA, async ($, on) => {
  stubEngine(on)
  const fs = stubFs(on)
  stubModel(on, [])
  const step = (idx: number, t0: number) => ({ k: 'step', t0, t1: t0 + 1, turn: 't0', idx, thread: 'main', model: 'claude-opus-5-5', in: 10, out: 400, cr: 90000, cw: 3000, ctx: 93010, msgs: 4, tools: [] })
  const kept = { v: 1, sid: SID, project: 'x', startedAt: 0, savedAt: 0, version: '0.1.0', settings: {}, dropped: 0, groups: { 'main||claude-opus-5-5': { steps: 2, in: 20, out: 800, cr: 180000, cw: 6000 } }, names: {}, timings: {}, records: [step(0, 0), step(1, 1000)] }
  fs.dirs.add('/home/me/meter')
  fs.dirs.add('/home/me/meter/sessions')
  fs.files.set(`/home/me/meter/sessions/${SID}.json`, { text: JSON.stringify(kept), mtimeMs: 0 })
  await $.session.start({ cwd: '/home/me/src/app', surface: 'terminal', isInteractive: true })
  await runStep($, { ...STEP, index: 2 })
  const tree = await paneText($)
  expect(tree).toContain('3 main')
  expect(tree).toContain('read 270K')
})

test('/clear writes the old session and starts the next one in a file of its own', DATA, async ($, on) => {
  const { clock, session } = stubEngine(on)
  const fs = stubFs(on)
  stubModel(on, [])
  await $.session.start({ cwd: '/home/me/src/app', surface: 'terminal', isInteractive: true })
  await runStep($, STEP)
  await $.session.end({ reason: 'clear', sessionId: SID, resume: { id: SID } } as never)
  expect(JSON.parse(fs.files.get(`/home/me/meter/sessions/${SID}.json`)!.text).groups['main||claude-opus-5-5'].steps).toBe(1)

  session.id = '9a9a9a9a-0000-4000-8000-000000000001'
  await runStep($, STEP)
  await runStep($, { ...STEP, index: 1 })
  await $.turn.complete(TURN as never)
  await clock.advance(15000)
  expect(JSON.parse(fs.files.get(`/home/me/meter/sessions/${session.id}.json`)!.text).groups['main||claude-opus-5-5'].steps).toBe(2)
})

test('/meter report adds up the session files of the last days, and skips emptied ones', DATA, async ($, on) => {
  const { clock } = stubEngine(on)
  const fs = stubFs(on)
  stubModel(on, [])
  const other = { v: 1, sid: 'other-session-0001', project: 'x', startedAt: 0, savedAt: 0, version: '0.1.0', settings: {}, dropped: 0, groups: { 'subagent|Explore|claude-sonnet-5-5': { steps: 3, in: 10, out: 10, cr: 100, cw: 10 } }, names: {}, timings: {}, records: [] }
  fs.files.set('/home/me/meter/sessions/other-session-0001.json', { text: JSON.stringify(other), mtimeMs: 0 })
  fs.files.set('/home/me/meter/sessions/emptied-session-01.json', { text: '{"v":1,"expired":true}', mtimeMs: 0 })
  fs.dirs.add('/home/me/meter')
  fs.dirs.add('/home/me/meter/sessions')
  await $.session.start({ cwd: '/home/me/src/app', surface: 'terminal', isInteractive: true })
  await runStep($, STEP)
  await clock.advance(1000)

  const out = await $.command.run({ command: 'meter', args: 'report 7', ...RUN } as never)
  expect(String(out.text)).toContain('2 sessions in the last 7 days (1 emptied file skipped)')
  expect(String(out.text)).toContain('Agents     main')
  expect(String(out.text)).toContain('Explore')
})

test('session files past the retention days are emptied when a session starts', { options: { dataDir: '/home/me/meter', retentionDays: 1 } }, async ($, on) => {
  const { clock } = stubEngine(on)
  const fs = stubFs(on)
  await clock.advance(3 * 86400000)
  fs.dirs.add('/home/me/meter')
  fs.dirs.add('/home/me/meter/sessions')
  fs.files.set('/home/me/meter/sessions/old-session-0001.json', { text: '{"v":1,"sid":"old-session-0001","records":[],"groups":{}}', mtimeMs: 0 })
  fs.files.set('/home/me/meter/sessions/new-session-0001.json', { text: '{"v":1,"sid":"new-session-0001","records":[],"groups":{}}', mtimeMs: 3 * 86400000 - 1000 })
  await $.session.start({ cwd: '/home/me/src/app', surface: 'terminal', isInteractive: true })
  expect(fs.files.get('/home/me/meter/sessions/old-session-0001.json')!.text).toBe('{"v":1,"expired":true}')
  expect(fs.files.get('/home/me/meter/sessions/new-session-0001.json')!.text).toContain('new-session-0001')
})

/** Answers the guard's question with `answer`; undefined dismisses it. Returns the questions asked. */
function stubAsk(on: On, answer: string | undefined) {
  const asked: string[] = []
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

const AGENT = 'agent-7f3a'
const SEND = { to: AGENT, text: 'fix the bug in secret.ts', origin: { kind: 'model' } }

/** A session where the Explore subagent AGENT took one step, `idleMin` minutes ago. */
async function idleAgent($: Engine, on: On, idleMin: number) {
  const engine = stubEngine(on)
  stubModel(on, [])
  await $.session.start({ cwd: '/home/me/src/app', surface: 'terminal', isInteractive: true })
  await $.classic.SubagentStart({ agent_id: AGENT, agent_type: 'Explore' })
  await runStep($, { ...STEP, agentId: AGENT })
  await engine.clock.advance(idleMin * 60000)
  return engine
}

test('by default, resuming an agent whose cache went cold shows a toast and goes on', async ($, on) => {
  const asked = stubAsk(on, 'Spawn a fresh agent')
  const { toasts } = await idleAgent($, on, 6)
  const sent = await $.session.send(SEND as never)
  expect(sent.isDelivered).toBe(true)
  expect(asked).toEqual([])
  expect(toasts).toEqual(['oxen-meter: resuming Explore 7f3a after 6m writes its 93K context again (~107K eq).'])

  await runStep($, { ...STEP, agentId: AGENT, index: 1 })
  expect(toasts.length).toBe(1)
})

test('in ask mode, "Spawn a fresh agent" keeps the message from the cold agent and tells Claude what to do', { options: { resumeGuard: 'ask' } }, async ($, on) => {
  const asked = stubAsk(on, 'Spawn a fresh agent')
  await idleAgent($, on, 6)
  const sent = await $.session.send(SEND as never)
  expect(sent.isDelivered).toBe(false)
  expect(String(sent.reason)).toContain('The user chose not to resume Explore 7f3a')
  expect(asked).toEqual(['oxen-meter: Explore 7f3a has sat 6m, past its 5m cache. Resuming it writes its 93K context again: about 107K token equivalents. Spawn a fresh agent with a short handoff instead?'])
})

test('in ask mode, "Resume anyway" sends the message', { options: { resumeGuard: 'ask' } }, async ($, on) => {
  stubAsk(on, 'Resume anyway')
  await idleAgent($, on, 6)
  expect((await $.session.send(SEND as never)).isDelivered).toBe(true)
})

test('in ask mode with no one to answer, the message goes and the meter notes it', { options: { resumeGuard: 'ask', dataDir: '/home/me/meter' } }, async ($, on) => {
  stubAsk(on, undefined)
  const fs = stubFs(on)
  await idleAgent($, on, 6)
  expect((await $.session.send(SEND as never)).isDelivered).toBe(true)
  await $.session.end({ reason: 'other', sessionId: SID, resume: { id: SID } } as never)
  const text = fs.files.get(`/home/me/meter/sessions/${SID}.json`)!.text
  expect(JSON.parse(text).records.find((r: { k: string }) => r.k === 'send')).toMatchObject({ to: AGENT, risk: true, mode: 'ask', answer: 'unanswered' })
  expect(text).not.toContain('secret')
})

test('a warm agent, a message from a plugin, or the guard turned off asks nothing and warns of nothing', { options: { resumeGuard: 'ask' } }, async ($, on) => {
  const asked = stubAsk(on, 'Spawn a fresh agent')
  const { toasts, clock } = await idleAgent($, on, 1)
  expect((await $.session.send(SEND as never)).isDelivered).toBe(true)
  await clock.advance(10 * 60000)
  expect((await $.session.send({ ...SEND, origin: { kind: 'plugin', name: 'other' } } as never)).isDelivered).toBe(true)
  expect((await $.session.send({ ...SEND, to: 'someone-else' } as never)).isDelivered).toBe(true)
  expect([asked, toasts]).toEqual([[], []])
})

test('with the guard off, a cold resume is only recorded', { options: { resumeGuard: 'off' } }, async ($, on) => {
  const asked = stubAsk(on, 'Spawn a fresh agent')
  const { toasts } = await idleAgent($, on, 6)
  expect((await $.session.send(SEND as never)).isDelivered).toBe(true)
  await runStep($, { ...STEP, agentId: AGENT, index: 1 })
  expect([asked, toasts]).toEqual([[], []])
})

test('a thread that wakes on its own after its cache went cold gets a toast, once', async ($, on) => {
  const { toasts } = await idleAgent($, on, 6)
  await runStep($, { ...STEP, agentId: AGENT, index: 1 })
  await runStep($, { ...STEP, agentId: AGENT, index: 2 })
  expect(toasts).toEqual(['oxen-meter: Explore 7f3a woke after 6m with a cold cache: writing 93K context again (~107K eq).'])
})

test('a session resumed after its cache expired is a cold resume of main in the report', DATA, async ($, on) => {
  stubEngine(on)
  stubFs(on)
  stubModel(on, [])
  await $.session.start({ cwd: '/home/me/src/app', surface: 'terminal', isInteractive: true })
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: 7200, context_tokens: 180000, prompt_cache_likely_expired: true } as never)
  const out = await $.command.run({ command: 'meter', args: 'report', ...RUN } as never)
  expect(String(out.text)).toContain('main (resumed)  idle 2h00m  wrote 180K')
})

test('a model switch reports the main thread\'s TTL, which the pane takes as measured', async ($, on) => {
  stubEngine(on)
  stubModel(on, [])
  await $.session.start({ cwd: '/home/me/src/app', surface: 'terminal', isInteractive: true })
  await runStep($, STEP)
  await $.classic.PostModelSwitch({ from_model: 'a', to_model: 'b', requested_model: null, source: 'command', context_tokens: 1, prompt_cache_warm: true, cache_ttl: '5m', estimated_cache_write_usd: 0, pricing: 'catalog' } as never)
  expect(await paneText($)).toContain('main 5m (measured: 1)')
})

test('/meter export writes the last days\' sessions, anonymized, to the exports folder through the guard', { options: { dataDir: '/home/me/meter', userLabel: 'Nhon N.' } }, async ($, on) => {
  stubEngine(on)
  const fs = stubFs(on)
  stubModel(on, [])
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false } }) as never)
  await $.session.start({ cwd: '/home/me/src/app', surface: 'terminal', isInteractive: true })
  await $.classic.SubagentStart({ agent_id: AGENT, agent_type: 'Explore' })
  await runStep($, { ...STEP, agentId: AGENT })
  await runStep($, STEP)
  await $.tool.call({ tool: 'Bash', command: 'git commit -m "secret message"' } as never)

  const out = await $.command.run({ command: 'meter', args: 'export', ...RUN } as never)
  const path = fs.writes.find(p => p.includes('/exports/'))!
  expect(path).toMatch(/^\/home\/me\/meter\/exports\/oxen-meter-export-\d{8}-nhon-n\.json$/)
  expect(String(out.text)).toContain(`Wrote 1 session of the last 30 days to ${path}`)
  const text = fs.files.get(path)!.text
  expect(JSON.parse(text)).toMatchObject({ kind: 'oxen-meter-export', v: 1, label: 'Nhon N.', days: 30, summary: { sessions: 1 } })
  expect(JSON.parse(text).sessions[0].id).toMatch(/^[0-9a-f]{12}$/)
  for (const kept of [SID, AGENT, 'secret', '/home/me']) {
    expect(text).not.toContain(kept)
  }
})

test('with no data folder, /meter export writes nothing and says how to set one', async ($, on) => {
  stubEngine(on)
  const fs = stubFs(on)
  await $.session.start({ cwd: '/home/me/src/app', surface: 'terminal', isInteractive: true })
  const out = await $.command.run({ command: 'meter', args: 'export 7', ...RUN } as never)
  expect(fs.writes).toEqual([])
  expect(String(out.text)).toContain('set Data folder')
})

test('a command\'s output leaves the plugin\'s name to Claude Code, which shows it', DATA, async ($, on) => {
  stubEngine(on)
  stubFs(on)
  await $.session.start({ cwd: '/home/me/src/app', surface: 'terminal', isInteractive: true })
  for (const args of ['report', 'export', 'nonsense']) {
    expect(String((await $.command.run({ command: 'meter', args, ...RUN } as never)).text)).not.toMatch(/^oxen-meter:/)
  }
})

test('a hook\'s timing counts the meter\'s own code, not the tool it waited on', async ($, on) => {
  stubEngine(on)
  stubModel(on, [])
  on('tool.call', { tool: 'Bash' }, () => {
    const until = performance.now() + 80
    while (performance.now() < until) {
      // A Codex run that takes a while.
    }
    return { result: { stdout: '', stderr: '', interrupted: false } } as never
  })
  await $.session.start({ cwd: '/home/me/src/app', surface: 'terminal', isInteractive: true })
  await runStep($, STEP)
  await $.tool.call({ tool: 'Bash', command: 'codex exec "review"' } as never)
  const slowest = Number(/tool\.call[\s\S]*?max (\d+\.\d+)/.exec(await paneText($))?.[1])
  expect(slowest).toBeLessThan(40)
})

test('a rate-limit window that moves is recorded as a quota reading, once per move, and the file says it is Claude Code\'s', DATA, async ($, on) => {
  const { clock } = stubEngine(on)
  const fs = stubFs(on)
  stubModel(on, [])
  await $.session.start({ cwd: '/home/me/src/app', surface: 'terminal', isInteractive: true })
  await runStep($, STEP)
  const measure = (used: number, changed: string[]) => $.session.measure({ context: { window: 200000 }, rateLimits: [{ kind: 'seven_day', percentUsed: used, resetsAt: '2026-10-10T00:00:00Z' }], changed } as never)
  await measure(40, ['rateLimits'])
  await measure(40, ['context'])
  await measure(41, ['rateLimits'])
  await $.turn.complete(TURN as never)
  await clock.advance(15000)
  const file = JSON.parse(fs.files.get(`/home/me/meter/sessions/${SID}.json`)!.text)
  expect(file.tool).toBe('claude')
  expect(file.settings.cachedWeight).toBe(0.1)
  expect(file.records.filter((r: { k: string }) => r.k === 'quota').map((r: { used: number; windowMin: number }) => [r.windowMin, r.used])).toEqual([[10080, 40], [10080, 41]])
})

test('/meter report adds a Codex session file the CLI wrote beside Claude Code\'s own, by tool', DATA, async ($, on) => {
  const { clock } = stubEngine(on)
  const fs = stubFs(on)
  stubModel(on, [])
  const codex = { v: 1, sid: 'codex-01a10fca-84e7-7a11-84c6-7df06f2c6a83', tool: 'codex', project: 'x', startedAt: 0, savedAt: 0, version: '1.1.0', settings: {}, dropped: 0, groups: { 'main||gpt-6.1-sol': { steps: 3, in: 1000, out: 10, cr: 9000, cw: 0 } }, names: {}, timings: {}, records: [] }
  fs.files.set(`/home/me/meter/sessions/${codex.sid}.json`, { text: JSON.stringify(codex), mtimeMs: 0 })
  fs.dirs.add('/home/me/meter')
  fs.dirs.add('/home/me/meter/sessions')
  await $.session.start({ cwd: '/home/me/src/app', surface: 'terminal', isInteractive: true })
  await runStep($, STEP)
  await clock.advance(1000)
  const out = String((await $.command.run({ command: 'meter', args: 'report', ...RUN } as never)).text)
  expect(out).toContain('Tools      claude 1 session')
  expect(out).toContain('codex 1 session, 1.9K eq')
})
