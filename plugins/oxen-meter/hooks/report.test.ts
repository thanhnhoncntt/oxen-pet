import { expect, test } from 'claude-code/testing'

import { COLORS, fmtTokens, paneRows, shortModel } from './report'
import { MAIN, addEvent, addStep, newCollector, stepRecordOf } from './record'
import { noteTiming } from './timing'

const MIN = 60000
const usage = (cr: number, cw: number) => ({ input_tokens: 1000, output_tokens: 2000, cache_read_input_tokens: cr, cache_creation_input_tokens: cw, model: 'claude-opus-5-5-20261001' })
const step = (agentId?: string) => ({ turnId: 't', index: 0, model: 'claude-opus-5-5', messageCount: 3, ...(agentId ? { agentId } : {}) })
const TTL = { main: 60, subagent: 5 }

test('tokens read as K and M, and a model loses its claude- prefix and date', () => {
  expect([fmtTokens(850), fmtTokens(1234), fmtTokens(52000), fmtTokens(1234567)]).toEqual(['850', '1.2K', '52K', '1.2M'])
  expect([shortModel('claude-opus-5-5-20261001'), shortModel('claude-sonnet-5-5'), shortModel('gpt-5.4')]).toEqual(['opus-5-5', 'sonnet-5-5', 'gpt-5.4'])
})

test('an empty session says nothing has been measured yet', () => {
  expect(paneRows(newCollector(), [], 0, TTL)).toEqual([{ label: 'Cache', value: 'no model step yet' }])
})

test('the cache row adds every step: the hit rate, then read, written, uncached and output tokens', () => {
  const c = newCollector()
  addStep(c, stepRecordOf(step(), { toolUses: [], stopReason: 'end_turn', usage: usage(0, 40000) }, 0, 1000, c))
  addStep(c, stepRecordOf(step(), { toolUses: [], stopReason: 'end_turn', usage: usage(118000, 1000) }, MIN, MIN + 1000, c))
  const rows = paneRows(c, [], 2 * MIN, TTL)
  expect(rows[0]).toEqual({ label: 'Cache', value: 'hit 73% · read 118K · written 41K · uncached 2.0K · output 4.0K' })
  expect(rows[1]).toEqual({ label: 'Steps', value: '2 main' })
})

test('each live thread shows its model, its context, how long since its cache was read, and how long the cache has left', () => {
  const c = newCollector()
  addEvent(c, { k: 'agent-start', t: 0, thread: 'agent-7f3a', agentType: 'Explore' })
  addStep(c, stepRecordOf(step(), { toolUses: [], stopReason: 'end_turn', usage: usage(100000, 20000) }, 0, 1000, c))
  addStep(c, stepRecordOf(step('agent-7f3a'), { toolUses: [], stopReason: 'end_turn', usage: usage(30000, 9000) }, 0, 1000, c))
  const rows = paneRows(c, [{ id: 'agent-7f3a', status: 'running' }, { id: 'agent-done', status: 'completed' }], 4 * MIN + 30000, TTL)
  expect(rows.find(r => r.label === 'main')).toEqual({ label: 'main', value: 'opus-5-5 · ctx 121K · read 4m ago · warm ~56m', color: COLORS.warm })
  expect(rows.find(r => r.label === 'Explore 7f3a')).toEqual({ label: 'Explore 7f3a', value: 'opus-5-5 · ctx 40K · read 4m ago · cooling ~1m', color: COLORS.cooling })
  expect(rows.find(r => r.label.includes('done'))).toBeUndefined()
  const later = paneRows(c, [{ id: 'agent-7f3a', status: 'idle' }], 6 * MIN, TTL)
  expect(later.find(r => r.label === 'Explore 7f3a')).toEqual({ label: 'Explore 7f3a', value: 'opus-5-5 · ctx 40K · read 6m ago · cold', color: COLORS.cold })
})

test('a live agent with no step yet says so, and the hooks row shows the meter\'s own cost', () => {
  const c = newCollector()
  addStep(c, stepRecordOf(step(), { toolUses: [], stopReason: 'end_turn', usage: usage(1, 1) }, 0, 1, c))
  noteTiming(c.timings, 'turn.step', 0.05)
  const rows = paneRows(c, [{ id: 'agent-1b2c', status: 'pending' }], 1, TTL)
  expect(rows.find(r => r.label === 'agent 1b2c')).toEqual({ label: 'agent 1b2c', value: 'no step yet' })
  expect(rows.at(-1)).toEqual({ label: 'turn.step', value: '0.05 ms mean · p95 0.05 · max 0.05 · 1 call' })
  expect(MAIN).toBe('main')
})

test('handoffs, outcomes and compactions each get a row once there is one', () => {
  const c = newCollector()
  addStep(c, stepRecordOf(step(), { toolUses: [], stopReason: 'end_turn', usage: usage(1, 1) }, 0, 1, c))
  expect(paneRows(c, [], 1, TTL).map(r => r.label)).not.toContain('Handoffs')
  addEvent(c, { k: 'agent-call', t0: 0, t1: 5 * MIN, thread: MAIN, agent: 'a1', status: 'completed' })
  addEvent(c, { k: 'agent-call', t0: 0, t1: 1, thread: MAIN, agent: 'a2', status: 'async_launched', bg: true })
  addEvent(c, { k: 'codex', t0: 0, t1: 3 * MIN, thread: 'a1', sub: 'task' })
  addEvent(c, { k: 'codex', t0: 0, t1: 1, thread: 'a1', sub: 'review', bg: true, failed: true })
  addEvent(c, { k: 'outcome', t: 1, thread: MAIN, outcome: 'commit' })
  addEvent(c, { k: 'outcome', t: 2, thread: MAIN, outcome: 'commit' })
  addEvent(c, { k: 'outcome', t: 3, thread: MAIN, outcome: 'pr' })
  addEvent(c, { k: 'compact', t0: 0, t1: 1, thread: MAIN, trigger: 'auto', before: 150000, after: 20000, stepsSeen: 0 })
  const rows = paneRows(c, [], 1, TTL)
  expect(rows.find(r => r.label === 'Handoffs')).toEqual({ label: 'Handoffs', value: '2 Agent (1 background) · 2 Codex (1 background, 1 failed)' })
  expect(rows.find(r => r.label === 'Outcomes')).toEqual({ label: 'Outcomes', value: '2 commits · 1 PR' })
  expect(rows.find(r => r.label === 'Compactions')).toEqual({ label: 'Compactions', value: '1: 150K → 20K' })
})
