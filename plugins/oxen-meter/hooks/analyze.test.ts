import { expect, test } from 'claude-code/testing'

import { cacheSamples, coldResumes, flagsOf, gapCurve, handoffsOf, hitRate, inferTtl, quotaUsed, summarize, tokenEquivalent, writeWeight } from './analyze'
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

test('a message that resumes an agent is a handoff too: back when the agent stops, and the reaction before it counts', () => {
  const records: MeterRecord[] = [
    { k: 'agent-call', t0: 0, t1: 3 * MIN, thread: MAIN, agent: 'a1', status: 'completed' },
    { k: 'send', t: 10 * MIN, thread: MAIN, to: 'a1', risk: true, gapMs: 9 * MIN, ctx: 80 * K, mode: 'ask', answer: 'resume' },
    { k: 'agent-stop', t: 14 * MIN, thread: 'a1', agentType: 'Explore' },
    { k: 'send', t: 20 * MIN, thread: MAIN, to: 'a1', risk: false, gapMs: 1 * MIN, ctx: 80 * K, mode: 'ask', answer: 'fresh' },
  ]
  expect(handoffsOf(records)).toEqual([
    { kind: 'agent', thread: MAIN, t0: 0, bg: false, workMs: 3 * MIN, reactMs: 7 * MIN },
    { kind: 'resume', thread: MAIN, t0: 10 * MIN, bg: true, workMs: 4 * MIN },
  ])
})

test('each session is judged on its own: the last step of one never pairs with the first step of the next', () => {
  const a = steps([{ at: 0, cw: 100 * K }, { at: 1, cr: 100 * K, cw: 1 * K }])
  const b = steps([{ at: 70, cw: 101 * K, msgs: 10 }, { at: 71, cr: 101 * K, cw: 1 * K, msgs: 12 }])
  const groups = { 'main||claude-opus-5-5': { steps: 2, in: 1000, out: 1600, cr: 100 * K, cw: 101 * K } }
  const s = summarize([{ sid: 'a', startedAt: 0, records: a, groups }, { sid: 'b', startedAt: 70 * MIN, records: b, groups }], { mainTtl: 'auto', subagentTtl: 'auto', coldTokens: 50 * K, outputWeight: 5 })
  expect(s.cold).toEqual([])
  expect([s.ttl.main.warm, s.ttl.main.cold]).toEqual([2, 0])
})

// Fixture: a Codex thread, which writes nothing to the cache: warm after 2 and 18 minutes, its prefix alone read after 90.
const CODEX = steps([
  { at: 0, in: 20 * K, model: 'gpt-6.1-sol' },
  { at: 2, in: 2 * K, cr: 20 * K, model: 'gpt-6.1-sol' },
  { at: 20, in: 3 * K, cr: 22 * K, model: 'gpt-6.1-sol' },
  { at: 110, in: 24.6 * K, cr: 6.4 * K, model: 'gpt-6.1-sol' },
])

// Fixture: Devin on Claude, pinging its cache every 4m45s while the user is away, then going on warm.
const FABLE = 'claude-fable-5-1-medium'
const KEEPALIVE = steps([
  { at: 0, cw: 40 * K, model: FABLE },
  { at: 4.75, in: 4, cr: 40 * K, out: 1, model: FABLE },
  { at: 9.5, in: 4, cr: 40 * K, out: 1, model: FABLE },
  { at: 14.25, in: 4, cr: 40 * K, out: 1, model: FABLE },
  { at: 16, cr: 40 * K, cw: 1 * K, model: FABLE },
]).map((r, i) => (i >= 1 && i <= 3 ? { ...r, keepalive: true as const } : r))

test('a step that sent its context again in full is cold, though nothing was written: how a Codex miss shows', () => {
  expect(cacheSamples(CODEX).map(s => [s.gapMs / MIN, s.warm, s.model])).toEqual([[2, true, 'gpt-6.1-sol'], [18, true, 'gpt-6.1-sol'], [90, false, 'gpt-6.1-sol']])
})

test('another tool\'s cold resume is a cold step after five minutes or more, priced by what it sent again', () => {
  expect(coldResumes(CODEX, TTL, 10 * K, { tool: 'codex', cachedWeight: 0.1 })).toEqual([{ t: 110 * MIN, thread: MAIN, role: 'main', tool: 'codex', model: 'gpt-6.1-sol', gapMs: 90 * MIN, cw: 24.6 * K, extra: 22140 }])
  expect(coldResumes(CODEX, TTL, 10 * K, { tool: 'codex', cachedWeight: 0.5 })[0]!.extra).toBe(12300)
  expect(coldResumes(CODEX, TTL, 10 * K)).toEqual([])
})

test('the gap curve counts the warm and cold samples by how long the cache sat, from five minutes', () => {
  expect(gapCurve(cacheSamples(CODEX))).toEqual([
    { fromMin: 5, toMin: 10, warm: 0, cold: 0 },
    { fromMin: 10, toMin: 30, warm: 1, cold: 0 },
    { fromMin: 30, toMin: 60, warm: 0, cold: 0 },
    { fromMin: 60, toMin: 120, warm: 0, cold: 1 },
    { fromMin: 120, toMin: 360, warm: 0, cold: 0 },
    { fromMin: 360, warm: 0, cold: 0 },
  ])
})

test('a keepalive is never judged, but the step after it is judged against it', () => {
  expect(cacheSamples(KEEPALIVE).map(s => [s.gapMs / MIN, s.warm])).toEqual([[1.75, true]])
})

test('the quota used adds each window\'s moves within an hour of each other, and starts over when the window resets', () => {
  const q = (atMin: number, used: number, resetsAt: number, windowMin = 10080): MeterRecord => ({ k: 'quota', t: atMin * MIN, thread: MAIN, windowMin, used, resetsAt })
  const ends = 195 * MIN
  const next = ends + 7 * 24 * 60 * MIN
  const records = [q(0, 50, ends), q(10, 53, ends), q(20, 55, ends), q(180, 70, ends), q(190, 72, ends), q(200, 1, next), q(210, 4, next), q(0, 10, 0, 300), q(30, 30, 0, 300)]
  expect(quotaUsed(records)).toEqual({ 10080: 11, 300: 20 })
})

test('readings from threads that report a little late, or from two accounts at once, never count a point twice, nor a dip as a reset', () => {
  const q = (atMin: number, used: number, thread = MAIN): MeterRecord => ({ k: 'quota', t: atMin * MIN, thread, windowMin: 10080, used, resetsAt: 1000 })
  expect(quotaUsed([q(0, 59), q(1, 58, 'a1'), q(2, 59), q(3, 58, 'a1'), q(4, 60), q(5, 59, 'a1')])).toEqual({ 10080: 1 })
  const twoAccounts = (atMin: number, used: number, resetsAt: number): MeterRecord => ({ k: 'quota', t: atMin * MIN, thread: MAIN, windowMin: 10080, used, resetsAt })
  const far = 5 * 24 * 60 * MIN
  expect(quotaUsed([twoAccounts(0, 30, far), twoAccounts(1, 0, far + 22 * 60 * MIN), twoAccounts(2, 30, far), twoAccounts(3, 0, far + 22 * 60 * MIN), twoAccounts(4, 31, far), twoAccounts(5, 1, far + 22 * 60 * MIN)])).toEqual({ 10080: 2 })
  const noReset = (atMin: number, used: number): MeterRecord => ({ k: 'quota', t: atMin * MIN, thread: MAIN, windowMin: 300, used })
  expect(quotaUsed([noReset(0, 80), noReset(10, 85), noReset(20, 3), noReset(30, 9)])).toEqual({ 300: 14 })
})

test('the summary weighs each tool\'s steps its own way, and keeps the Claude Code TTL to Claude Code\'s samples', () => {
  const opts = { mainTtl: 'auto', subagentTtl: 'auto', coldTokens: 10 * K, outputWeight: 5, cachedWeight: 0.25 } as const
  const codexRecords: MeterRecord[] = [
    ...CODEX,
    { k: 'compact', t0: 120 * MIN, t1: 121 * MIN, thread: MAIN, trigger: 'auto', usage: { in: 30 * K, out: 2 * K, cr: 0, cw: 0 }, stepsSeen: 0 },
    { k: 'quota', t: 0, thread: MAIN, windowMin: 10080, used: 50 },
    { k: 'quota', t: 10 * MIN, thread: MAIN, windowMin: 10080, used: 53 },
  ]
  const s = summarize([
    { sid: 'c', startedAt: 0, records: WARM, groups: { 'main||claude-opus-5-5': { steps: 4, in: 2000, out: 3200, cr: 97 * K, cw: 40 * K } } },
    { sid: 'x', startedAt: 0, tool: 'codex', records: codexRecords, groups: { 'main||gpt-6.1-sol': { steps: 4, in: 49.6 * K, out: 3200, cr: 48.4 * K, cw: 0 }, 'main|compaction|gpt-6.1-sol': { steps: 1, in: 30 * K, out: 2 * K, cr: 0, cw: 0 } } },
    { sid: 'd', startedAt: 0, tool: 'devin', records: KEEPALIVE, groups: { [`main||${FABLE}`]: { steps: 5, in: 512, out: 803, cr: 160 * K, cw: 41 * K } } },
  ], opts)
  expect(Object.keys(s.byTool)).toEqual(['claude', 'codex', 'devin'])
  expect(s.byTool.codex!.sessions).toBe(1)
  expect(s.byTool.codex!.eq).toBe(49.6 * K + 48.4 * K * 0.25 + 3200 * 5 + 30 * K + 2 * K * 5)
  expect(s.byTool.devin!.eq).toBe(512 + 41 * K * 1.25 + 160 * K * 0.1 + 803 * 5)
  expect(s.ttl.main).toMatchObject({ source: 'default', warm: 3 })
  expect(Object.keys(s.gaps)).toEqual(['codex|gpt-6.1'])
  expect(s.cold.map(c => [c.tool, c.thread])).toEqual([['codex', MAIN]])
  expect(s.byAgentType.compaction!.steps).toBe(1)
  expect(s.compaction).toEqual({ count: 1, eq: 30 * K + 2 * K * 5 })
  expect(s.keepalive).toEqual({ steps: 3, eq: 3 * (4 + 40 * K * 0.1 + 5) })
  expect(s.quota).toEqual({ 'codex|10080': 3 })
})
