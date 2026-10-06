import { expect, test } from 'claude-code/testing'

import { DROP_CHUNK, MAIN, MAX_RECORDS, addEvent, addStep, agentCallOf, gapOf, newCollector, stepRecordOf } from './record'

const USAGE = { input_tokens: 12, output_tokens: 300, cache_read_input_tokens: 40000, cache_creation_input_tokens: 2000, model: 'claude-opus-5-5' }
const STEP = { turnId: 't1', index: 0, model: 'claude-opus-5-5', effort: 'high' as const, messageCount: 9 }
const RESULT = { toolUses: [{ name: 'Read' }, { name: 'mcp__gh__search' }], serverToolUses: [{ name: 'advisor' }], stopReason: 'tool_use' as const, usage: USAGE }

test('a main step records its tokens, its context, the tools it asked for, and the model that answered', () => {
  const c = newCollector()
  const rec = stepRecordOf(STEP, { ...RESULT, usage: { ...USAGE, model: 'claude-opus-5-5-20261001' } }, 1000, 4000, c)
  expect(rec).toEqual({
    k: 'step', t0: 1000, t1: 4000, turn: 't1', idx: 0, thread: MAIN, model: 'claude-opus-5-5-20261001', effort: 'high',
    in: 12, out: 300, cr: 40000, cw: 2000, ctx: 42012, msgs: 9, tools: ['Read', 'mcp__gh__search', 'advisor'], stop: 'tool_use',
  })
  expect(rec.gapMs).toBeUndefined()
})

test('the gap is from the start of the thread\'s last step, when its cache was last read', () => {
  const c = newCollector()
  addStep(c, stepRecordOf(STEP, RESULT, 1000, 61000, c))
  expect(gapOf(c, MAIN, 70000)).toBe(69000)
  const second = stepRecordOf({ ...STEP, index: 1 }, RESULT, 70000, 72000, c)
  expect(second.gapMs).toBe(69000)
})

test('each subagent is its own thread, named by its type once it started', () => {
  const c = newCollector()
  addEvent(c, { k: 'agent-start', t: 500, thread: 'a1', agentType: 'Explore' })
  addStep(c, stepRecordOf(STEP, RESULT, 1000, 2000, c))
  const sub = stepRecordOf({ ...STEP, agentId: 'a1', model: 'claude-sonnet-5-5' }, { ...RESULT, usage: { ...USAGE, model: 'claude-sonnet-5-5' } }, 3000, 4000, c)
  expect(sub.thread).toBe('a1')
  expect(sub.agentType).toBe('Explore')
  expect(sub.gapMs).toBeUndefined()
  addStep(c, sub)
  expect(Object.keys(c.threads).sort()).toEqual(['a1', MAIN])
  expect(c.threads.a1).toEqual({ lastT0: 3000, lastT1: 4000, lastCtx: 42012, lastModel: 'claude-sonnet-5-5', lastMsgs: 9, steps: 1, agentType: 'Explore' })
})

test('a step with no response records no tokens and says so', () => {
  const c = newCollector()
  const failed = stepRecordOf(STEP, { toolUses: [], stopReason: null, usage: null }, 1000, 1500, c)
  expect([failed.in, failed.out, failed.cr, failed.cw, failed.ctx, failed.noUsage, failed.model]).toEqual([0, 0, 0, 0, 0, true, 'claude-opus-5-5'])
  const aborted = stepRecordOf(STEP, undefined, 1000, 1500, c)
  expect([aborted.noUsage, aborted.tools, aborted.stop]).toEqual([true, [], undefined])
})

test('the groups keep exact totals by role, agent type and model', () => {
  const c = newCollector()
  addEvent(c, { k: 'agent-start', t: 0, thread: 'a1', agentType: 'Explore' })
  addStep(c, stepRecordOf(STEP, RESULT, 1, 2, c))
  addStep(c, stepRecordOf({ ...STEP, index: 1 }, RESULT, 3, 4, c))
  addStep(c, stepRecordOf({ ...STEP, agentId: 'a1' }, RESULT, 5, 6, c))
  expect(c.groups).toEqual({
    'main||claude-opus-5-5': { steps: 2, in: 24, out: 600, cr: 80000, cw: 4000 },
    'subagent|Explore|claude-opus-5-5': { steps: 1, in: 12, out: 300, cr: 40000, cw: 2000 },
  })
})

test('past MAX_RECORDS the oldest steps go, the events stay, and the totals stay exact', () => {
  const c = newCollector()
  addEvent(c, { k: 'outcome', t: 0, thread: MAIN, outcome: 'commit' })
  for (let i = 0; i <= MAX_RECORDS; i++) {
    addStep(c, stepRecordOf({ ...STEP, index: i }, RESULT, i, i, c))
  }
  expect(c.records.length).toBe(MAX_RECORDS + 2 - DROP_CHUNK)
  expect(c.dropped).toBe(DROP_CHUNK)
  expect(c.records[0]).toEqual({ k: 'outcome', t: 0, thread: MAIN, outcome: 'commit' })
  expect(c.records[1]).toMatchObject({ k: 'step', idx: DROP_CHUNK })
  expect(c.groups['main||claude-opus-5-5']!.steps).toBe(MAX_RECORDS + 1)
})

test('a step that starts while a compaction runs is counted for it', () => {
  const c = newCollector()
  c.compacting += 1
  addStep(c, stepRecordOf(STEP, RESULT, 1, 2, c))
  expect(c.stepsInCompaction).toBe(1)
  c.compacting -= 1
  addStep(c, stepRecordOf(STEP, RESULT, 3, 4, c))
  expect(c.stepsInCompaction).toBe(1)
})

test('any record marks the collector dirty, for the next flush', () => {
  const c = newCollector()
  expect(c.dirty).toBe(false)
  addEvent(c, { k: 'outcome', t: 0, thread: MAIN, outcome: 'pr' })
  expect(c.dirty).toBe(true)
})

test('an Agent call\'s result names the type of the agent it started', () => {
  const c = newCollector()
  addEvent(c, { k: 'agent-call', t0: 0, t1: 10, thread: MAIN, agent: 'a2', agentType: 'Plan', status: 'completed' })
  expect(stepRecordOf({ ...STEP, agentId: 'a2' }, RESULT, 20, 30, c).agentType).toBe('Plan')
})

const AGENT_USAGE = { input_tokens: 1, output_tokens: 2, cache_creation_input_tokens: 9000, cache_read_input_tokens: 30000, server_tool_use: null, service_tier: null }

test('a finished Agent call records the agent, its type, model and tokens, and the TTL its cache writes used', () => {
  const result = { status: 'completed', agentId: 'a1', agentType: 'Explore', resolvedModel: 'claude-sonnet-5-5', totalTokens: 41000, prompt: 'secret', content: [], usage: { ...AGENT_USAGE, cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 9000 } } }
  expect(agentCallOf(result, 10, 90, MAIN)).toEqual([
    { k: 'agent-call', t0: 10, t1: 90, thread: MAIN, agent: 'a1', agentType: 'Explore', model: 'claude-sonnet-5-5', status: 'completed', tokens: 41000, cw5m: 9000, cw1h: 0 },
    { k: 'ttl', t: 90, thread: 'a1', ttl: '5m', source: 'agent-call' },
  ])
  const hour = { ...result, usage: { ...AGENT_USAGE, cache_creation: { ephemeral_1h_input_tokens: 9000, ephemeral_5m_input_tokens: 0 } } }
  expect(agentCallOf(hour, 10, 90, MAIN)[1]).toEqual({ k: 'ttl', t: 90, thread: 'a1', ttl: '1h', source: 'agent-call' })
})

test('a background Agent call records its launch with no TTL, and a teammate its spawn', () => {
  expect(agentCallOf({ status: 'async_launched', agentId: 'a2', description: 'x', prompt: 'secret', outputFile: '/tmp/o', resolvedModel: 'claude-opus-5-5' }, 1, 2, 'a9')).toEqual([
    { k: 'agent-call', t0: 1, t1: 2, thread: 'a9', agent: 'a2', model: 'claude-opus-5-5', status: 'async_launched', bg: true },
  ])
  expect(agentCallOf({ status: 'teammate_spawned', agentId: 'a3', agent_id: 'a3', agent_type: 'reviewer', teammate_id: 'r@t', name: 'r', prompt: 'secret' }, 1, 2, MAIN)).toEqual([
    { k: 'agent-call', t0: 1, t1: 2, thread: MAIN, agent: 'a3', agentType: 'reviewer', status: 'teammate_spawned', bg: true },
  ])
})

test('an Agent call that failed or answered oddly records only that it happened', () => {
  expect(agentCallOf(undefined, 1, 2, MAIN)).toEqual([{ k: 'agent-call', t0: 1, t1: 2, thread: MAIN, status: 'failed' }])
  expect(agentCallOf('text', 1, 2, MAIN)).toEqual([{ k: 'agent-call', t0: 1, t1: 2, thread: MAIN, status: 'unknown' }])
})
