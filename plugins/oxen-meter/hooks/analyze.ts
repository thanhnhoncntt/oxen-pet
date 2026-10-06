import { MAIN } from './record'
import type { Group, MeterRecord, StepRecord, Usage } from './record'
import type { TtlSetting } from './settings'

/**
 * What the records say, as pure functions: the hit rate, the token equivalent, each step's cache judged warm or cold,
 * the TTL of each role, the cold resumes, the handoffs and the anti-patterns. `register.tsx`, `/meter report` and
 * `tools/meter/aggregate.mjs` all read the records through here.
 */

export type Role = 'main' | 'subagent'
export const roleOf = (thread: string): Role => (thread === MAIN ? 'main' : 'subagent')

const MIN = 60000
const READ_WEIGHT = 0.1
/** Past the shorter TTL with some slack: a gap this long tells 5m from 1h. */
const PAST_5M_MS = 5.5 * MIN
const HOUR_MS = 60 * MIN
const WARM_SHARE = 0.5 // a step read at least this share of the context before it: its cache was warm
const MIN_CONTEXT = 2000 // a context smaller than this judges nothing

/** What one token written to the cache weighs against an uncached one, for a cache of `ttlMin`. */
export const writeWeight = (ttlMin: number) => (ttlMin >= 60 ? 2 : 1.25)

/** Cache read over the whole context the steps carried, from 0 to 1. */
export function hitRate(u: Usage) {
  const whole = u.in + u.cr + u.cw

  return whole > 0 ? u.cr / whole : 0
}

/** The steps' cost in uncached input tokens: writes weigh `w`, reads 0.1, output `outputWeight`. */
export const tokenEquivalent = (u: Usage, w: number, outputWeight: number) => u.in + u.cw * w + u.cr * READ_WEIGHT + u.out * outputWeight

const isStep = (r: MeterRecord): r is StepRecord => r.k === 'step'

/** A step judged against the step before it in its thread: whether it read the cache that step left. */
export type Sample = { thread: string; role: Role; t0: number; gapMs: number; warm: boolean; cr: number; cw: number; prevCtx: number }

/**
 * Each step with the step before it in its thread, as the cache judges it: warm when it read at least half of that
 * step's context, cold when it wrote at least half of it again. Left out, as no evidence of the TTL: a step after a
 * compaction, a model change or a rewind (fewer messages), after a context too small, or with no usage.
 */
export function cacheSamples(records: readonly MeterRecord[]): Sample[] {
  const compactions = records.filter(r => r.k === 'compact')
  const last: Record<string, StepRecord> = {}
  const samples: Sample[] = []
  for (const s of records.filter(isStep)) {
    const prev = last[s.thread]
    last[s.thread] = s
    if (!prev || s.noUsage || prev.noUsage || prev.ctx < MIN_CONTEXT || s.model !== prev.model || s.msgs < prev.msgs) {
      continue
    }
    if (compactions.some(c => c.thread === s.thread && c.t1 >= prev.t0 && c.t0 <= s.t0)) {
      continue
    }
    const warm = s.cr >= WARM_SHARE * prev.ctx
    if (warm || s.cw >= WARM_SHARE * prev.ctx) {
      samples.push({ thread: s.thread, role: roleOf(s.thread), t0: s.t0, gapMs: s.t0 - prev.t0, warm, cr: s.cr, cw: s.cw, prevCtx: prev.ctx })
    }
  }

  return samples
}

export type TtlSource = 'setting' | 'measured' | 'inferred' | 'default'

/** A role's TTL, where it came from, and the samples behind it. */
export type TtlView = {
  role: Role
  min: number
  source: TtlSource
  warm: number
  cold: number
  longestWarmMs?: number
  shortestColdMs?: number
  measured: { '5m': number; '1h': number }
}

/**
 * The TTL of `role`: the setting's when it names one; else the one Claude Code reported (an Agent call's cache writes,
 * a model switch), by count; else the one the samples show (a cold step between 5.5 and 60 minutes says 5m, a warm one
 * past 5.5 minutes says 1h, both or neither say nothing); else 1h for main and 5m for a subagent.
 */
export function inferTtl(samples: readonly Sample[], records: readonly MeterRecord[], role: Role, setting: TtlSetting): TtlView {
  const own = samples.filter(s => s.role === role)
  const warm = own.filter(s => s.warm)
  const cold = own.filter(s => !s.warm)
  const measured = { '5m': 0, '1h': 0 }
  for (const r of records) {
    if (r.k === 'ttl' && roleOf(r.thread) === role) {
      measured[r.ttl] += 1
    }
  }
  const longestWarmMs = warm.length > 0 ? Math.max(...warm.map(s => s.gapMs)) : undefined
  const shortestColdMs = cold.length > 0 ? Math.min(...cold.map(s => s.gapMs)) : undefined
  const view = { role, warm: warm.length, cold: cold.length, ...(longestWarmMs !== undefined ? { longestWarmMs } : {}), ...(shortestColdMs !== undefined ? { shortestColdMs } : {}), measured }
  if (setting !== 'auto') {
    return { ...view, min: setting === '5m' ? 5 : 60, source: 'setting' }
  }
  if (measured['5m'] + measured['1h'] > 0) {
    return { ...view, min: measured['1h'] >= measured['5m'] ? 60 : 5, source: 'measured' }
  }
  const says5m = cold.some(s => s.gapMs > PAST_5M_MS && s.gapMs < HOUR_MS)
  const says1h = warm.some(s => s.gapMs > PAST_5M_MS && s.gapMs <= HOUR_MS)
  if (says5m !== says1h) {
    return { ...view, min: says5m ? 5 : 60, source: 'inferred' }
  }

  return { ...view, min: role === 'main' ? 60 : 5, source: 'default' }
}

/** A cold resume: a step that wrote its whole context again after its cache's TTL, or a main session resumed so. */
export type ColdResume = { t: number; thread: string; role: Role; agentType?: string; model: string; gapMs: number; cw: number; extra: number }

/**
 * The cold resumes: a step whose gap passed its role's TTL, that wrote at least `coldTokens` and did not read the
 * context before it back; and a main session resumed after its cache likely expired, with that much context.
 * `extra` is what the write cost beyond reading it, in token equivalents. The exclusions of `cacheSamples` apply.
 */
export function coldResumes(records: readonly MeterRecord[], ttlMin: Record<Role, number>, coldTokens: number): ColdResume[] {
  const judged = new Map(cacheSamples(records).map(s => [`${s.thread}@${s.t0}`, s]))
  const found: ColdResume[] = []
  for (const r of records) {
    if (r.k === 'step') {
      const s = judged.get(`${r.thread}@${r.t0}`)
      const ttl = ttlMin[roleOf(r.thread)]
      if (s && !s.warm && s.gapMs > ttl * MIN && r.cw >= coldTokens) {
        found.push({ t: r.t0, thread: r.thread, role: s.role, ...(r.agentType !== undefined ? { agentType: r.agentType } : {}), model: r.model, gapMs: s.gapMs, cw: r.cw, extra: Math.round(r.cw * (writeWeight(ttl) - READ_WEIGHT)) })
      }
    } else if (r.k === 'main-resume' && r.expired && r.ctx >= coldTokens) {
      found.push({ t: r.t, thread: MAIN, role: 'main', model: '', gapMs: r.idleS * 1000, cw: r.ctx, extra: Math.round(r.ctx * (writeWeight(ttlMin.main) - READ_WEIGHT)) })
    }
  }

  return found
}

/**
 * A handoff: work a thread gave to a subagent, to Codex, or back to an agent by a message that resumed it; how long it
 * took to come back, and how long the thread took to hand off again.
 */
export type Handoff = { kind: 'agent' | 'codex' | 'resume'; thread: string; t0: number; bg: boolean; workMs?: number; reactMs?: number }

/**
 * The handoffs, in order. A call that waits returns when it ends; a background agent, or one a message resumed, when
 * its next SubagentStop comes; a background Codex run has no return the meter sees. A message the user refused to
 * send is none. The reaction runs from the return to the thread's next handoff.
 */
export function handoffsOf(records: readonly MeterRecord[]): Handoff[] {
  const stops = new Map<string, number[]>()
  for (const r of records) {
    if (r.k === 'agent-stop') {
      stops.set(r.thread, [...(stops.get(r.thread) ?? []), r.t])
    }
  }
  const stopAfter = (agent: string | undefined, t: number) => (agent === undefined ? undefined : stops.get(agent)?.find(s => s >= t))
  type Call = { kind: Handoff['kind']; thread: string; t0: number; bg: boolean; back: number | undefined }
  const calls = records
    .flatMap((r): Call[] => {
      if (r.k === 'agent-call') {
        return [{ kind: 'agent', thread: r.thread, t0: r.t0, bg: r.bg === true, back: r.bg ? stopAfter(r.agent, r.t0) : r.t1 }]
      }
      if (r.k === 'codex') {
        return [{ kind: 'codex', thread: r.thread, t0: r.t0, bg: r.bg === true, back: r.bg ? undefined : r.t1 }]
      }
      if (r.k === 'send' && r.answer !== 'fresh') {
        return [{ kind: 'resume', thread: r.thread, t0: r.t, bg: true, back: stopAfter(r.to, r.t) }]
      }
      return []
    })
    .sort((a, b) => a.t0 - b.t0)

  return calls.map(c => {
    const next = c.back === undefined ? undefined : calls.find(n => n.thread === c.thread && n.t0 >= c.back!)
    return {
      kind: c.kind,
      thread: c.thread,
      t0: c.t0,
      bg: c.bg,
      ...(c.back !== undefined ? { workMs: c.back - c.t0 } : {}),
      ...(next !== undefined && c.back !== undefined ? { reactMs: next.t0 - c.back } : {}),
    }
  })
}

export type FlagKind = 'cold-resume' | 'expensive-short' | 'context-bloat' | 'big-first-prefix'
export type Flag = { kind: FlagKind; thread: string; t: number; detail: string }

const EXPENSIVE = /opus|fable/i
const SHORT_STEPS = 5
const SHORT_OUTPUT = 20000
const BLOAT_CONTEXT = 150000
const BLOAT_STEPS = 20
const BIG_PREFIX = 40000

/**
 * The anti-patterns, by time then thread: each cold resume; a subagent on an expensive model for a short task (five
 * steps or fewer, 20K output or less); a thread whose context stayed at 150K or more for 20 steps without a compaction;
 * a thread whose first request carried 40K or more (tool schemas, MCP servers, a large prompt).
 */
export function flagsOf(records: readonly MeterRecord[], cold: readonly ColdResume[]): Flag[] {
  const flags: Flag[] = cold.map(c => ({ kind: 'cold-resume', thread: c.thread, t: c.t, detail: `${Math.round(c.gapMs / MIN)}m idle, ${c.cw} written` }))
  const byThread = new Map<string, StepRecord[]>()
  for (const s of records.filter(isStep)) {
    byThread.set(s.thread, [...(byThread.get(s.thread) ?? []), s])
  }
  const compactions = records.filter(r => r.k === 'compact')
  for (const [thread, own] of byThread) {
    const first = own[0]!
    if (first.ctx >= BIG_PREFIX) {
      flags.push({ kind: 'big-first-prefix', thread, t: first.t0, detail: `${first.ctx} in the first request` })
    }
    const output = own.reduce((n, s) => n + s.out, 0)
    if (thread !== MAIN && own.length <= SHORT_STEPS && output <= SHORT_OUTPUT && EXPENSIVE.test(first.model)) {
      flags.push({ kind: 'expensive-short', thread, t: first.t0, detail: `${own.length} steps, ${output} output on ${first.model}` })
    }
    let run = 0
    for (let i = 0; i < own.length; i++) {
      const s = own[i]!
      const compacted = i > 0 && compactions.some(c => c.thread === thread && c.t1 >= own[i - 1]!.t0 && c.t0 <= s.t0)
      run = s.ctx >= BLOAT_CONTEXT && !compacted ? run + 1 : 0
      if (run === BLOAT_STEPS) {
        flags.push({ kind: 'context-bloat', thread, t: s.t0, detail: `${BLOAT_STEPS} steps at ${BLOAT_CONTEXT}+ context` })
      }
    }
  }

  return flags.sort((a, b) => a.t - b.t || a.thread.localeCompare(b.thread) || a.kind.localeCompare(b.kind))
}

/** One session as the summary reads it: its records, and its exact totals by role, agent type and model. */
export type SessionData = { sid: string; startedAt: number; records: readonly MeterRecord[]; groups: Readonly<Record<string, Group>> }

export type Totals = Usage & { steps: number }
export type Weighed = Totals & { eq: number }
export type SummaryOptions = { mainTtl: TtlSetting; subagentTtl: TtlSetting; coldTokens: number; outputWeight: number }

export type Summary = {
  sessions: number
  totals: Totals
  eq: number
  byRole: Record<Role, Weighed>
  byModel: Record<string, Weighed>
  byAgentType: Record<string, Weighed>
  ttl: Record<Role, TtlView>
  cold: ColdResume[]
  handoffs: Handoff[]
  flags: Flag[]
}

const zero = (): Weighed => ({ steps: 0, in: 0, out: 0, cr: 0, cw: 0, eq: 0 })

function addTo(into: Weighed, g: Group, eq: number) {
  into.steps += g.steps
  into.in += g.in
  into.out += g.out
  into.cr += g.cr
  into.cw += g.cw
  into.eq += eq
}

/** The TTL of each role over `records`, as `inferTtl` gives it. */
export function ttlOf(records: readonly MeterRecord[], o: Pick<SummaryOptions, 'mainTtl' | 'subagentTtl'>): Record<Role, TtlView> {
  const samples = cacheSamples(records)

  return { main: inferTtl(samples, records, 'main', o.mainTtl), subagent: inferTtl(samples, records, 'subagent', o.subagentTtl) }
}

/** What a set of sessions adds up to: exact totals from their groups, the rest from their records. */
export function summarize(sessions: readonly SessionData[], o: SummaryOptions): Summary {
  const records = sessions.flatMap(s => s.records)
  const ttl = ttlOf(records, o)
  const ttlMin = { main: ttl.main.min, subagent: ttl.subagent.min }
  const totals = { steps: 0, in: 0, out: 0, cr: 0, cw: 0 }
  const byRole = { main: zero(), subagent: zero() }
  const byModel: Record<string, Weighed> = {}
  const byAgentType: Record<string, Weighed> = {}
  for (const s of sessions) {
    for (const [key, g] of Object.entries(s.groups)) {
      const [roleName, agentType = '', model = ''] = key.split('|')
      const role: Role = roleName === 'main' ? 'main' : 'subagent'
      const eq = tokenEquivalent(g, writeWeight(ttlMin[role]), o.outputWeight)
      totals.steps += g.steps
      totals.in += g.in
      totals.out += g.out
      totals.cr += g.cr
      totals.cw += g.cw
      addTo(byRole[role], g, eq)
      addTo((byModel[model] ??= zero()), g, eq)
      addTo((byAgentType[role === 'main' ? 'main' : agentType || 'subagent'] ??= zero()), g, eq)
    }
  }
  const cold = coldResumes(records, ttlMin, o.coldTokens)

  return {
    sessions: sessions.length,
    totals,
    eq: byRole.main.eq + byRole.subagent.eq,
    byRole,
    byModel,
    byAgentType,
    ttl,
    cold,
    handoffs: handoffsOf(records),
    flags: flagsOf(records, cold),
  }
}
