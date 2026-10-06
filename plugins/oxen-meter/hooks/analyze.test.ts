import { expect, test } from 'claude-code/testing'

import { cacheSamples, coldResumes, flagsOf, handoffsOf, hitRate, inferTtl, summarize, tokenEquivalent, writeWeight } from './analyze'
import { MAIN } from './record'
import type { EventRecord, MeterRecord, StepRecord } from './record'

const MIN = 60000
const K = 1000

type S = { thread?: string; at: number; cr?: number; cw?: number; in?: number; out?: number; model?: string; msgs?: number; agentType?: string }

/** Step records from a script: `at` in minutes, the gap and context worked out per thread as the collector would. */
function steps(script: S[]): StepRecord[] {
  const last: Record<string, number> = {}
  let msgs = 2
  return script.map((s, idx) => {
    const thread = s.thread ?? MAIN
    const t0 = s.at * MIN
    const u = { in: s.in ?? 500, out: s.out ?? 800, cr: s.cr ?? 0, cw: s.cw ?? 0 }
    const prev = last[thread]
    last[thread] = t0
    msgs += 2
    return {
      k: 'step', t0, t1: t0 + 20000, turn: 't', idx, thread, ...(s.agentType ? { agentType: s.agentType } : {}), model: s.model ?? 'claude-opus-5-5',
      ...u, ctx: u.in + u.cr + u.cw, ...(prev !== undefined ? { gapMs: t0 - prev } : {}), msgs: s.msgs ?? msgs, tools: [],
    } as StepRecord
  })
}

const TTL = { main: 60, subagent: 5 }

// Fixture: a warm main thread, a minute or three between steps.
const WARM = steps([
  { at: 0, cw: 30 * K },
  { at: 1, cr: 30 * K, cw: 2 * K },
  { at: 3, cr: 32 * K, cw: 3 * K },
  { at: 6, cr: 35 * K, cw: 5 * K },
])

// Fixture: an Explore subagent with 400K of context left idle for an hour, then resumed.
const COLD: MeterRecord[] = steps([
  { thread: 'a1', agentType: 'Explore', at: 0, cw: 300 * K },
  { thread: 'a1', agentType: 'Explore', at: 1, cr: 300 * K, cw: 60 * K },
  { thread: 'a1', agentType: 'Explore', at: 2, cr: 360 * K, cw: 40 * K },
  { thread: 'a1', agentType: 'Explore', at: 64, cr: 15 * K, cw: 395 * K },
])

// Fixture: a subagent whose cache is gone after 7 minutes, and a main thread still warm after 20.
const SUB_5M = steps([
  { thread: 'a2', at: 0, cw: 40 * K },
  { thread: 'a2', at: 2, cr: 40 * K, cw: 2 * K },
  { thread: 'a2', at: 9, cr: 0, cw: 44 * K },
  { thread: 'a2', at: 10, cr: 44 * K, cw: 1 * K },
  { at: 0, cw: 50 * K },
  { at: 20, cr: 50 * K, cw: 1 * K },
])

// Fixture: a main thread compacted while it sat idle, then on.
const COMPACTED: MeterRecord[] = [
  ...steps([{ at: 0, cw: 150 * K }, { at: 1, cr: 150 * K, cw: 2 * K }]),
  { k: 'compact', t0: 60 * MIN, t1: 61 * MIN, thread: MAIN, trigger: 'manual', before: 152 * K, after: 20 * K, stepsSeen: 0 },
  ...steps([{ at: 70, cr: 0, cw: 22 * K, msgs: 3 }]).map(s => ({ ...s, gapMs: 69 * MIN })),
]

test('the hit rate is cache read over the whole context, and the token equivalent weighs each kind', () => {
  expect(hitRate({ in: 100, out: 0, cr: 900, cw: 0 })).toBe(0.9)
  expect(hitRate({ in: 0, out: 5, cr: 0, cw: 0 })).toBe(0)
  expect(tokenEquivalent({ in: 100, out: 10, cr: 1000, cw: 200 }, 1.25, 5)).toBe(500)
  expect([writeWeight(5), writeWeight(60)]).toEqual([1.25, 2])
})

test('a warm thread gives warm samples and no cold resume', () => {
  const samples = cacheSamples(WARM)
  expect(samples.map(s => [s.gapMs / MIN, s.warm])).toEqual([[1, true], [2, true], [3, true]])
  expect(coldResumes(WARM, TTL, 50 * K)).toEqual([])
  const ttl = inferTtl(samples, WARM, 'main', 'auto')
  expect(ttl).toMatchObject({ role: 'main', min: 60, source: 'default', warm: 3, cold: 0, longestWarmMs: 3 * MIN })
})

test('a subagent resumed after its cache went cold is a cold resume, with what the re-write cost beyond a read', () => {
  const cold = coldResumes(COLD, TTL, 50 * K)
  expect(cold).toEqual([{ t: 64 * MIN, thread: 'a1', role: 'subagent', agentType: 'Explore', model: 'claude-opus-5-5', gapMs: 62 * MIN, cw: 395 * K, extra: 454250 }])
  expect(coldResumes(COLD, TTL, 500 * K)).toEqual([])
  expect(cacheSamples(COLD).at(-1)).toMatchObject({ warm: false, gapMs: 62 * MIN })
})

test('the TTL of each role is inferred from the gaps around its warm and cold samples', () => {
  const samples = cacheSamples(SUB_5M)
  expect(inferTtl(samples, SUB_5M, 'subagent', 'auto')).toMatchObject({ role: 'subagent', min: 5, source: 'inferred', warm: 2, cold: 1, longestWarmMs: 2 * MIN, shortestColdMs: 7 * MIN })
  expect(inferTtl(samples, SUB_5M, 'main', 'auto')).toMatchObject({ role: 'main', min: 60, source: 'inferred', warm: 1, cold: 0, longestWarmMs: 20 * MIN })
})

test('a TTL measured from an Agent call or a model switch wins over one inferred, and a setting wins over both', () => {
  const measured: EventRecord[] = [{ k: 'ttl', t: 0, thread: 'a9', ttl: '1h', source: 'agent-call' }, { k: 'ttl', t: 0, thread: MAIN, ttl: '5m', source: 'model-switch' }]
  const records = [...SUB_5M, ...measured]
  const samples = cacheSamples(records)
  expect(inferTtl(samples, records, 'subagent', 'auto')).toMatchObject({ min: 60, source: 'measured', measured: { '5m': 0, '1h': 1 } })
  expect(inferTtl(samples, records, 'main', 'auto')).toMatchObject({ min: 5, source: 'measured', measured: { '5m': 1, '1h': 0 } })
  expect(inferTtl(samples, records, 'subagent', '5m')).toMatchObject({ min: 5, source: 'setting' })
})

test('a step after a compaction, a model change, or a rewind is no sample and no cold resume', () => {
  expect(cacheSamples(COMPACTED).map(s => s.gapMs / MIN)).toEqual([1])
  expect(coldResumes(COMPACTED, TTL, 10 * K)).toEqual([])
  const switched = steps([{ at: 0, cw: 80 * K }, { at: 70, cw: 81 * K, model: 'claude-sonnet-5-5' }])
  expect(cacheSamples(switched)).toEqual([])
  expect(coldResumes(switched, TTL, 10 * K)).toEqual([])
  const rewound = steps([{ at: 0, cw: 80 * K, msgs: 30 }, { at: 70, cw: 60 * K, msgs: 12 }])
  expect(cacheSamples(rewound)).toEqual([])
})

test('a main session resumed after its cache expired is a cold resume of main', () => {
  const records: MeterRecord[] = [{ k: 'main-resume', t: 5 * MIN, thread: MAIN, idleS: 7200, ctx: 180 * K, expired: true }, { k: 'main-resume', t: 6 * MIN, thread: MAIN, idleS: 60, ctx: 180 * K, expired: false }]
  expect(coldResumes(records, TTL, 50 * K)).toEqual([{ t: 5 * MIN, thread: MAIN, role: 'main', model: '', gapMs: 7200000, cw: 180 * K, extra: 342000 }])
})

test('a handoff runs from the call to its result, and its reaction to the thread\'s next handoff', () => {
  const records: MeterRecord[] = [
    { k: 'agent-call', t0: 10 * MIN, t1: 13 * MIN, thread: MAIN, agent: 'a1', status: 'completed' },
    { k: 'agent-call', t0: 15 * MIN, t1: 16 * MIN, thread: MAIN, agent: 'a2', status: 'completed' },
    { k: 'codex', t0: 20 * MIN, t1: 29 * MIN, thread: 'a2', sub: 'task' },
    { k: 'agent-call', t0: 30 * MIN, t1: 30 * MIN + 5000, thread: MAIN, agent: 'a3', status: 'async_launched', bg: true },
    { k: 'agent-stop', t: 40 * MIN, thread: 'a3', agentType: 'Plan' },
    { k: 'codex', t0: 41 * MIN, t1: 41 * MIN + 1000, thread: MAIN, sub: 'review', bg: true },
  ]
  expect(handoffsOf(records)).toEqual([
    { kind: 'agent', thread: MAIN, t0: 10 * MIN, bg: false, workMs: 3 * MIN, reactMs: 2 * MIN },
    { kind: 'agent', thread: MAIN, t0: 15 * MIN, bg: false, workMs: 1 * MIN, reactMs: 14 * MIN },
    { kind: 'codex', thread: 'a2', t0: 20 * MIN, bg: false, workMs: 9 * MIN },
    { kind: 'agent', thread: MAIN, t0: 30 * MIN, bg: true, workMs: 10 * MIN, reactMs: 1 * MIN },
    { kind: 'codex', thread: MAIN, t0: 41 * MIN, bg: true },
  ])
})

test('the anti-patterns: a short task on an expensive model, a context left to bloat, a big first prefix', () => {
  const short = steps([{ thread: 'a3', at: 0, cw: 20 * K, out: 900 }, { thread: 'a3', at: 1, cr: 20 * K, out: 900 }])
  const cheap = steps([{ thread: 'a4', at: 0, cw: 20 * K, model: 'claude-haiku-4-5' }])
  const bloat = steps(Array.from({ length: 22 }, (_, i) => ({ at: i, cr: 160 * K, cw: 1 * K })))
  const prefix = steps([{ thread: 'a5', at: 0, cw: 45 * K, model: 'claude-sonnet-5-5' }])
  const flags = flagsOf([...short, ...cheap, ...bloat, ...prefix], [])
  expect(flags.map(f => [f.kind, f.thread, f.t / MIN])).toEqual([
    ['expensive-short', 'a3', 0],
    ['big-first-prefix', 'a5', 0],
    ['big-first-prefix', MAIN, 0],
    ['context-bloat', MAIN, 19],
  ])
  expect(flagsOf([...steps([{ at: 0, cw: 30 * K }])], []).length).toBe(0)
})

test('the summary adds the sessions\' exact totals by role, model and agent type, with the token equivalent of each', () => {
  const groups = {
    'main||claude-opus-5-5': { steps: 4, in: 2000, out: 3200, cr: 97 * K, cw: 40 * K },
    'subagent|Explore|claude-sonnet-5-5': { steps: 4, in: 2000, out: 3200, cr: 675 * K, cw: 795 * K },
  }
  const s = summarize([{ sid: 's1', startedAt: 0, records: [...WARM, ...COLD], groups }], { mainTtl: 'auto', subagentTtl: 'auto', coldTokens: 50 * K, outputWeight: 5 })
  expect(s.sessions).toBe(1)
  expect(s.totals).toEqual({ steps: 8, in: 4000, out: 6400, cr: 772 * K, cw: 835 * K })
  expect(s.byRole.main.eq).toBe(2000 + 40 * K * 2 + 9700 + 16000)
  expect(s.byRole.subagent.eq).toBe(2000 + 795 * K * 1.25 + 67500 + 16000)
  expect(Object.keys(s.byModel)).toEqual(['claude-opus-5-5', 'claude-sonnet-5-5'])
  expect(Object.keys(s.byAgentType)).toEqual(['main', 'Explore'])
  expect(s.eq).toBe(s.byRole.main.eq + s.byRole.subagent.eq)
  expect(s.cold.map(c => c.thread)).toEqual(['a1'])
  expect(s.ttl.subagent.min).toBe(5)
})
