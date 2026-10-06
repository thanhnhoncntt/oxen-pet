import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

type On = Parameters<TestBody>[1]
type Engine = Parameters<TestBody>[0]

const PANE = { component: 'Pane', props: { title: 'oxen-meter', isFocused: false, bodyColumns: 90, placement: 'inline', scroll: { offset: 0, bodyRows: 14 }, view: {} } } as const
const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } } as const
const USAGE = { input_tokens: 10, output_tokens: 400, cache_read_input_tokens: 90000, cache_creation_input_tokens: 3000, model: 'claude-opus-5-5' }
const STEP = { turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 4 }
const SUMMARY = { role: 'user' as const, text: 'summary', toolUses: [] }

/** Answers what the meter asks of Claude Code: panes that are always placed, an agent list the test fills, toasts it keeps. */
function stubEngine(on: On, placed = true) {
  mock.clock(on)
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
  return { open, agents, toasts }
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
