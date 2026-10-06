import { expect, test } from 'claude-code/testing'

import { COLORS, filesText, fmtTokens, paneRows, reportText, shortModel } from './report'
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

const SUMMARY = {
  sessions: 3,
  totals: { steps: 40, in: 40000, out: 2100000, cr: 120e6, cw: 9.1e6 },
  eq: 41e6,
  byRole: { main: { steps: 30, in: 1, out: 1, cr: 1, cw: 1, eq: 30e6 }, subagent: { steps: 10, in: 1, out: 1, cr: 1, cw: 1, eq: 11e6 } },
  byModel: { 'claude-opus-5-5': { steps: 30, in: 0, out: 0, cr: 93, cw: 7, eq: 35e6 }, 'claude-sonnet-5-5': { steps: 10, in: 0, out: 0, cr: 80, cw: 20, eq: 6e6 } },
  byAgentType: { main: { steps: 30, in: 0, out: 0, cr: 0, cw: 0, eq: 30e6 }, Explore: { steps: 6, in: 0, out: 0, cr: 0, cw: 0, eq: 5e6 }, Plan: { steps: 4, in: 0, out: 0, cr: 0, cw: 0, eq: 6e6 } },
  ttl: {
    main: { role: 'main' as const, min: 60, source: 'measured' as const, warm: 9, cold: 0, measured: { '5m': 0, '1h': 3 } },
    subagent: { role: 'subagent' as const, min: 5, source: 'inferred' as const, warm: 9, cold: 4, longestWarmMs: 4 * MIN, shortestColdMs: 7 * MIN, measured: { '5m': 0, '1h': 0 } },
  },
  cold: [
    { t: Date.UTC(2026, 9, 5, 14, 2), thread: 'agent-3a9c', role: 'subagent' as const, agentType: 'Explore', model: 'claude-sonnet-5-5', gapMs: 62 * MIN, cw: 410000, extra: 471500 },
    { t: Date.UTC(2026, 9, 5, 9, 0), thread: MAIN, role: 'main' as const, model: '', gapMs: 125 * MIN, cw: 180000, extra: 342000 },
  ],
  handoffs: [
    { kind: 'agent' as const, thread: MAIN, t0: 0, bg: false, workMs: 3 * MIN, reactMs: 1 * MIN },
    { kind: 'agent' as const, thread: MAIN, t0: 1, bg: true },
    { kind: 'codex' as const, thread: 'a1', t0: 2, bg: false, workMs: 9 * MIN },
  ],
  flags: [
    { kind: 'context-bloat' as const, thread: MAIN, t: 0, detail: '' },
    { kind: 'context-bloat' as const, thread: 'a2', t: 0, detail: '' },
    { kind: 'big-first-prefix' as const, thread: MAIN, t: 0, detail: '' },
    { kind: 'cold-resume' as const, thread: MAIN, t: 0, detail: '' },
  ],
}

test('the report adds the sessions up: cache, token equivalent, models, agents, TTL, cold resumes, handoffs, flags', () => {
  expect(reportText(SUMMARY, { days: 7, skipped: 2 }).split('\n')).toEqual([
    'oxen-meter: 3 sessions in the last 7 days (2 emptied files skipped)',
    'Cache      hit 93% · read 120M · written 9.1M · uncached 40K · output 2.1M',
    'Token eq.  41M: main 30M · subagent 11M',
    'Models     opus-5-5 hit 93%, 35M eq · sonnet-5-5 hit 80%, 6.0M eq',
    'Agents     main 30M eq · Plan 6.0M · Explore 5.0M',
    'TTL        main 1h (measured: 3) · subagent 5m (inferred: 9 warm up to 4m, 4 cold from 7m)',
    'Cold       2 cold resumes: 590K written again, 814K eq beyond a read',
    '           2026-10-05 14:02 UTC  Explore 3a9c  sonnet-5-5  idle 1h02m  wrote 410K  +472K eq',
    '           2026-10-05 09:00 UTC  main (resumed)  idle 2h05m  wrote 180K  +342K eq',
    'Handoffs   2 Agent (1 background), median 3m back · 1 Codex, median 9m back · next handoff median 1m',
    'Flags      2 context bloat · 1 big first prefix',
  ])
})

test('a report with no session says where it looked', () => {
  expect(reportText({ ...SUMMARY, sessions: 0 }, { days: 7, skipped: 0 })).toBe('oxen-meter: no session in the last 7 days.')
})

test('the pane adds the session\'s token equivalent, TTLs, cold resumes and where its file goes', () => {
  const c = newCollector()
  addStep(c, stepRecordOf(step(), { toolUses: [], stopReason: 'end_turn', usage: usage(1, 1) }, 0, 1, c))
  const rows = paneRows(c, [], 1, TTL, { summary: SUMMARY, files: 'saved 0m ago to /x/sessions' })
  expect(rows.map(r => r.label).slice(0, 7)).toEqual(['Cache', 'Steps', 'Token eq.', 'TTL', 'Cold', 'main', 'Files'])
  expect(rows.find(r => r.label === 'Cold')).toEqual({ label: 'Cold', value: '2 cold resumes: 814K eq beyond a read', color: COLORS.cold })
  expect(rows.find(r => r.label === 'Files')).toEqual({ label: 'Files', value: 'saved 0m ago to /x/sessions' })
})

test('the files row says where the session goes, or why it does not', () => {
  expect(filesText({ root: undefined }, 0)).toBe('not saved: set Data folder in /plugin configure oxen-meter@oxen-pet')
  expect(filesText({ root: '/x' }, 0)).toBe('not saved yet: /x/sessions')
  expect(filesText({ root: '/x', savedAt: 0 }, 3 * MIN)).toBe('saved 3m ago to /x/sessions')
  expect(filesText({ root: '/x', savedAt: 0, error: 'the data folder is a symbolic link.' }, 3 * MIN)).toBe('not saved: the data folder is a symbolic link.')
})

test('resumes count among the handoffs', () => {
  const s = { ...SUMMARY, handoffs: [{ kind: 'resume' as const, thread: MAIN, t0: 0, bg: true, workMs: 4 * MIN }, { kind: 'resume' as const, thread: MAIN, t0: 1, bg: true }] }
  expect(reportText(s, { days: 7, skipped: 0 })).toContain('Handoffs   2 resumes (2 background), median 4m back')
})
