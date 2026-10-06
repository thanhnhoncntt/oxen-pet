import type { Outcome } from './codex'
import { newTimings } from './timing'
import type { Timings } from './timing'

/**
 * The meter's records: one per model step, and one per event around them (a subagent's start and stop, an Agent or
 * Codex handoff, a compaction, an outcome). Metadata only: token counts, times, model and tool names, agent types.
 * No prompt, output, code, path or command is ever kept. The collector holds them in memory; the hooks add to it in
 * place and return, and a timer writes it out.
 */

/** The main conversation's thread; every other thread is a subagent's, by its agent id. */
export const MAIN = 'main'
export const MAX_RECORDS = 20000
/** How many of the oldest steps go at once past MAX_RECORDS, so dropping stays rare. */
export const DROP_CHUNK = 1000

export type Usage = { in: number; out: number; cr: number; cw: number }

export type StepRecord = Usage & {
  k: 'step'
  t0: number // when the request was about to be sent: when the thread's cache was read
  t1: number // when the response was whole
  turn: string
  idx: number
  thread: string
  agentType?: string
  model: string
  effort?: string | number
  ctx: number // in + cr + cw: the context the request carried
  gapMs?: number // t0 minus the thread's previous step's t0
  msgs: number
  tools: string[]
  stop?: string
  noUsage?: true // no response, or one with no usage
  coldStart?: true // the meter judged the thread's cache cold before the request went
}

export type EventRecord =
  | { k: 'agent-start' | 'agent-stop'; t: number; thread: string; agentType: string }
  | { k: 'agent-call'; t0: number; t1: number; thread: string; agent?: string; agentType?: string; model?: string; status: string; bg?: true; tokens?: number; cw5m?: number; cw1h?: number }
  | { k: 'codex'; t0: number; t1: number; thread: string; sub: string; bg?: true; failed?: true }
  | { k: 'outcome'; t: number; thread: string; outcome: Outcome }
  | { k: 'compact'; t0: number; t1: number; thread: string; trigger: string; before?: number; after?: number; usage?: Usage; stepsSeen: number }
  | { k: 'main-resume'; t: number; thread: string; idleS: number; ctx: number; expired: boolean }
  | { k: 'ttl'; t: number; thread: string; ttl: '5m' | '1h'; source: 'model-switch' | 'agent-call' }

export type MeterRecord = StepRecord | EventRecord

/** Where a thread stands after its last step. */
export type ThreadState = { lastT0: number; lastT1: number; lastCtx: number; lastModel: string; lastMsgs: number; steps: number; agentType?: string }

/** Exact totals of one role, agent type and model, kept apart from the records so dropping records loses nothing. */
export type Group = Usage & { steps: number }

export type Collector = {
  records: MeterRecord[]
  dropped: number
  threads: Record<string, ThreadState>
  groups: Record<string, Group>
  agentTypes: Record<string, string> // agent id to its type
  names: Record<string, string> // the name SendMessage addresses an agent by, to its id
  timings: Timings
  dirty: boolean
  compacting: number // compactions running now
  stepsInCompaction: number // steps that started while one ran
}

export const newCollector = (): Collector => ({ records: [], dropped: 0, threads: {}, groups: {}, agentTypes: {}, names: {}, timings: newTimings(), dirty: false, compacting: 0, stepsInCompaction: 0 })

export const threadOf = (agentId: string | undefined) => agentId ?? MAIN

/** How long since `thread`'s last step started, at `t0`; undefined before its first step. */
export function gapOf(c: Collector, thread: string, t0: number) {
  const last = c.threads[thread]

  return last === undefined ? undefined : t0 - last.lastT0
}

type StepInput = { turnId: string; index: number; model: string; effort?: string | number; messageCount: number; agentId?: string }
type StepResult = { toolUses: readonly { name: string }[]; serverToolUses?: readonly { name: string }[]; stopReason: string | null; usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number; model: string } | null }

/** The record of one model step: `input` as `turn.step` received it, `result` as it resolved (undefined if it never did). */
export function stepRecordOf(input: StepInput, result: StepResult | undefined, t0: number, t1: number, c: Collector): StepRecord {
  const thread = threadOf(input.agentId)
  const u = result?.usage ?? undefined
  const usage = { in: u?.input_tokens ?? 0, out: u?.output_tokens ?? 0, cr: u?.cache_read_input_tokens ?? 0, cw: u?.cache_creation_input_tokens ?? 0 }
  const agentType = thread === MAIN ? undefined : c.agentTypes[thread]
  const gapMs = gapOf(c, thread, t0)
  const tools = [...(result?.toolUses ?? []), ...(result?.serverToolUses ?? [])].map(t => t.name)

  return {
    k: 'step',
    t0,
    t1,
    turn: input.turnId,
    idx: input.index,
    thread,
    ...(agentType !== undefined ? { agentType } : {}),
    model: u?.model || input.model,
    ...(input.effort !== undefined ? { effort: input.effort } : {}),
    ...usage,
    ctx: usage.in + usage.cr + usage.cw,
    ...(gapMs !== undefined ? { gapMs } : {}),
    msgs: input.messageCount,
    tools,
    ...(result?.stopReason ? { stop: result.stopReason } : {}),
    ...(u ? {} : { noUsage: true as const }),
  }
}

export const groupKey = (r: StepRecord) => `${r.thread === MAIN ? 'main' : 'subagent'}|${r.agentType ?? ''}|${r.model}`

function cap(c: Collector) {
  if (c.records.length <= MAX_RECORDS) {
    return
  }
  let left = DROP_CHUNK
  c.records = c.records.filter(r => !(r.k === 'step' && left-- > 0))
  c.dropped += DROP_CHUNK - Math.max(0, left)
}

/** Adds a step, in place: its record, its thread's state, and its group's totals. */
export function addStep(c: Collector, r: StepRecord) {
  c.records.push(r)
  const g = (c.groups[groupKey(r)] ??= { steps: 0, in: 0, out: 0, cr: 0, cw: 0 })
  g.steps += 1
  g.in += r.in
  g.out += r.out
  g.cr += r.cr
  g.cw += r.cw
  const steps = (c.threads[r.thread]?.steps ?? 0) + 1
  c.threads[r.thread] = { lastT0: r.t0, lastT1: r.t1, lastCtx: r.ctx, lastModel: r.model, lastMsgs: r.msgs, steps, ...(r.agentType !== undefined ? { agentType: r.agentType } : {}) }
  if (c.compacting > 0) {
    c.stepsInCompaction += 1
  }
  c.dirty = true
  cap(c)
}

/** Adds an event, in place. A subagent's start names its type for its later steps. */
export function addEvent(c: Collector, r: EventRecord) {
  c.records.push(r)
  if (r.k === 'agent-start') {
    c.agentTypes[r.thread] = r.agentType
  } else if (r.k === 'agent-call' && r.agent !== undefined && r.agentType !== undefined) {
    c.agentTypes[r.agent] = r.agentType
  }
  c.dirty = true
  cap(c)
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const str = (v: unknown) => (typeof v === 'string' && v !== '' ? v : undefined)

/**
 * The records of an Agent call that `thread` made, from its result: the agent it started, its type and model, and
 * for a finished one its tokens and the TTL its cache writes used, which is the one place a TTL is measured.
 * The prompt and the report are never read.
 */
export function agentCallOf(result: unknown, t0: number, t1: number, thread: string): EventRecord[] {
  if (result === undefined || result === null) {
    return [{ k: 'agent-call', t0, t1, thread, status: 'failed' }]
  }
  if (typeof result !== 'object') {
    return [{ k: 'agent-call', t0, t1, thread, status: 'unknown' }]
  }
  const r = result as Record<string, unknown>
  const status = str(r.status) ?? 'unknown'
  const agent = str(r.agentId) ?? str(r.agent_id)
  const agentType = str(r.agentType) ?? str(r.agent_type)
  const model = str(r.resolvedModel)
  const cache = ((r.usage as Record<string, unknown> | undefined)?.cache_creation ?? undefined) as Record<string, unknown> | undefined
  const cw5m = num(cache?.ephemeral_5m_input_tokens)
  const cw1h = num(cache?.ephemeral_1h_input_tokens)
  const tokens = num(r.totalTokens)
  const call: EventRecord = {
    k: 'agent-call',
    t0,
    t1,
    thread,
    ...(agent !== undefined ? { agent } : {}),
    ...(agentType !== undefined ? { agentType } : {}),
    ...(model !== undefined ? { model } : {}),
    status,
    ...(status !== 'completed' && status !== 'unknown' ? { bg: true as const } : {}),
    ...(tokens !== undefined ? { tokens } : {}),
    ...(cw5m !== undefined ? { cw5m } : {}),
    ...(cw1h !== undefined ? { cw1h } : {}),
  }
  const ttl = (cw1h ?? 0) > 0 ? '1h' : (cw5m ?? 0) > 0 ? '5m' : undefined
  if (ttl === undefined || agent === undefined) {
    return [call]
  }

  return [call, { k: 'ttl', t: t1, thread: agent, ttl, source: 'agent-call' }]
}
