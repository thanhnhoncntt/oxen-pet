import { MAIN, addCompaction, addEvent, addStep } from './record'
import type { Collector, EventRecord, StepRecord, Usage } from './record'

/**
 * Codex CLI's rollout files (`~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`) as the meter's records, one line at a
 * time, so the CLI can read a file of hundreds of megabytes from where it last stopped. Pure: a line in, operations
 * out, and a state that is plain JSON to keep between reads.
 *
 * A rollout is one thread: the session's main thread, or a subagent's, which names its parent and its path (the
 * address `send_message` and `followup_task` use). Each model request ends in a `token_usage_record`; the request
 * went after the last input line before it (a task start, a user message, a tool's output). Its input counts its cached
 * part. A record just before a `compacted` line was the compaction, so each record waits for the next line.
 *
 * Only metadata leaves: times, token counts, model and tool names, agent roles. Prompts, arguments, outputs and
 * instructions are never kept; the one path that leaves, the working folder in the `meta` operation, is for the CLI
 * to hash and drop.
 */

export type GuardMode = 'off' | 'warn' | 'ask'

/** Where the main thread sits in the agent paths: its subagents are `/root/<task>`. */
export const ROOT_PATH = '/root'
/** The tools a thread hands work to a subagent with, or gives one more. */
const NEW_AGENT = 'spawn_agent'
const FOLLOW_UPS = new Set(['followup_task', 'send_message'])
const INPUT_ITEMS = new Set(['function_call_output', 'custom_tool_call_output', 'local_shell_call_output', 'mcp_tool_call_output'])
const INPUT_ROLES = new Set(['user', 'developer', 'system'])
const CALLS = new Set(['function_call', 'custom_tool_call', 'local_shell_call', 'mcp_tool_call', 'web_search_call'])

type Raw = Partial<Record<'input_tokens' | 'cached_input_tokens' | 'cache_write_input_tokens' | 'output_tokens', number>>

/** A request Codex finished, held until the next line says whether it was a compaction. */
type Pending = { t0: number; t1: number; response: string; turn: string; usage: Usage; context: number; tools: string[] }

export type CodexState = {
  own?: { thread: string; session: string; parent?: string; role?: string; path?: string }
  model: string
  effort?: string
  inputAt?: number // the latest input line
  lastT1?: number // when the last request ended
  lastT0?: number // when the last step went, for the gap
  turn?: string
  idx: number
  tools: string[] // the tools the coming response called
  pending?: Pending
  usageRecords: boolean // the file has token_usage_record lines, so token_count is read for the rate limits alone
  lastCount?: string // Codex 0.122: the last token count's request usage, to leave a repeat out
  quota: Record<string, { used: number; resetsAt?: number }>
}

export type CodexOp =
  | { op: 'meta'; thread: string; session: string; parent?: string; role?: string; path?: string; cwd?: string; t: number }
  | { op: 'step'; record: StepRecord }
  | { op: 'compaction'; record: EventRecord; model: string; usage: Usage }
  | { op: 'event'; record: EventRecord }

export const newCodexState = (): CodexState => ({ model: '', idx: 0, tools: [], usageRecords: false, quota: {} })

const HEAD = /^\{"timestamp":"([^"]+)",(?:"ordinal":\d+,)?"type":"([a-z_]+)","payload":\{(?:"type":"([a-z_]+)")?/
const ROLE = /^\{"timestamp":"[^"]+",(?:"ordinal":\d+,)?"type":"response_item","payload":\{"type":"message",(?:"id":"[^"]*",)?"role":"([a-z]+)"/

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const str = (v: unknown) => (typeof v === 'string' && v !== '' ? v : undefined)
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function parsed(line: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(line)
    return isObject(value) && isObject(value.payload) ? value.payload : undefined
  } catch {
    return undefined
  }
}

/** A request's usage: its input less the cached part, which is read; Codex reports no writes, but takes one if it does. */
function usageOf(u: Raw): { usage: Usage; context: number } {
  const input = num(u.input_tokens)
  const cached = Math.min(num(u.cached_input_tokens), input)

  return { usage: { in: input - cached, cr: cached, cw: num(u.cache_write_input_tokens), out: num(u.output_tokens) }, context: input }
}

/** The agent path `target` names from the thread at `from`: a path as it is, else a name below `from`, `..` going up. */
export function agentPathOf(from: string, target: string) {
  const parts: string[] = []
  for (const p of (target.startsWith('/') ? target : `${from}/${target}`).split('/')) {
    if (p === '..') {
      parts.pop()
    } else if (p !== '' && p !== '.') {
      parts.push(p)
    }
  }

  return `/${parts.join('/')}`
}

const threadOf = (s: CodexState) => (s.own === undefined || s.own.thread === s.own.session ? MAIN : s.own.thread)
const pathOf = (s: CodexState) => s.own?.path ?? ROOT_PATH

/** When the request that ended at `t1` went: after the latest input line, or right after the last request ended. */
const startOf = (s: CodexState, t1: number) => Math.min(t1, Math.max(s.inputAt ?? t1, s.lastT1 ?? -Infinity))

function stepOf(s: CodexState, p: Pending): StepRecord {
  const thread = threadOf(s)
  if (p.turn !== s.turn) {
    s.turn = p.turn
    s.idx = 0
  }
  const gapMs = s.lastT0 === undefined ? undefined : p.t0 - s.lastT0
  s.lastT0 = p.t0
  const role = thread === MAIN ? undefined : s.own?.role

  return {
    k: 'step',
    t0: p.t0,
    t1: p.t1,
    turn: p.turn,
    idx: s.idx++,
    thread,
    ...(role !== undefined ? { agentType: role } : {}),
    model: s.model || 'unknown',
    ...(s.effort !== undefined ? { effort: s.effort } : {}),
    ...p.usage,
    ctx: p.usage.in + p.usage.cr + p.usage.cw,
    ...(gapMs !== undefined ? { gapMs } : {}),
    msgs: 0,
    tools: p.tools,
  }
}

/** The held request as a step, once a line other than its compaction came. */
function settle(s: CodexState): CodexOp[] {
  const p = s.pending
  s.pending = undefined

  return p === undefined ? [] : [{ op: 'step', record: stepOf(s, p) }]
}

function quotaOps(s: CodexState, t: number, limits: unknown): CodexOp[] {
  if (!isObject(limits)) {
    return []
  }
  return [limits.primary, limits.secondary].flatMap((w): CodexOp[] => {
    if (!isObject(w) || typeof w.window_minutes !== 'number' || typeof w.used_percent !== 'number') {
      return []
    }
    const windowMin = w.window_minutes
    const used = w.used_percent
    const resetsAt = typeof w.resets_at === 'number' ? w.resets_at * 1000 : undefined
    const last = s.quota[windowMin]
    if (last !== undefined && last.used === used && last.resetsAt === resetsAt) {
      return []
    }
    s.quota[windowMin] = { used, ...(resetsAt !== undefined ? { resetsAt } : {}) }
    return [{ op: 'event', record: { k: 'quota', t, thread: threadOf(s), windowMin, used, ...(resetsAt !== undefined ? { resetsAt } : {}) } }]
  })
}

/** A call's name, and what it hands to a subagent: a new one, or a task or message for one below this thread. */
function callOps(s: CodexState, t: number, p: Record<string, unknown>, mode: GuardMode): CodexOp[] {
  const name = str(p.name)
  if (name === undefined) {
    return []
  }
  s.tools.push(name)
  if (name !== NEW_AGENT && !FOLLOW_UPS.has(name)) {
    return []
  }
  let args: Record<string, unknown> = {}
  try {
    const value: unknown = JSON.parse(String(p.arguments ?? '{}'))
    args = isObject(value) ? value : {}
  } catch {
    return []
  }
  const thread = threadOf(s)
  if (name === NEW_AGENT) {
    const task = str(args.task_name)
    const agentType = str(args.agent_type)
    const model = str(args.model)
    return [{ op: 'event', record: { k: 'agent-call', t0: t, t1: t, thread, ...(task !== undefined ? { agent: `${pathOf(s)}/${task}` } : {}), ...(agentType !== undefined ? { agentType } : {}), ...(model !== undefined ? { model } : {}), status: 'started', bg: true } }]
  }
  const raw = str(args.target)
  const target = raw === undefined ? undefined : agentPathOf(pathOf(s), raw)
  // A message up to a parent, or to a sibling, resumes nothing this thread handed out.
  return target !== undefined && target.startsWith(`${pathOf(s)}/`) ? [{ op: 'event', record: { k: 'send', t, thread, to: target, risk: false, mode } }] : []
}

function metaOps(s: CodexState, t: number, p: Record<string, unknown>): CodexOp[] {
  const thread = str(p.id)
  const session = str(p.session_id) ?? thread
  if (s.own !== undefined || thread === undefined || session === undefined) {
    // A forked subagent's file copies its parent's meta after its own: only the first is the file's.
    return []
  }
  const origin = isObject(p.source) && isObject(p.source.subagent) && isObject(p.source.subagent.thread_spawn) ? p.source.subagent.thread_spawn : {}
  const parent = str(p.parent_thread_id) ?? str(origin.parent_thread_id)
  const role = str(p.agent_role) ?? str(origin.agent_role)
  const path = str(p.agent_path) ?? str(origin.agent_path)
  s.own = { thread, session, ...(parent !== undefined ? { parent } : {}), ...(role !== undefined ? { role } : {}), ...(path !== undefined ? { path } : {}) }
  const cwd = str(p.cwd)
  const ops: CodexOp[] = [{ op: 'meta', thread, session, ...(parent !== undefined ? { parent } : {}), ...(role !== undefined ? { role } : {}), ...(path !== undefined ? { path } : {}), ...(cwd !== undefined ? { cwd } : {}), t }]
  if (thread !== session) {
    ops.push({ op: 'event', record: { k: 'agent-start', t, thread, agentType: role ?? '' } })
  }

  return ops
}

/** One request of a Codex 0.122 file, which reports each in its token count; a repeat or an empty one is none. */
function countOps(s: CodexState, t: number, info: unknown): CodexOp[] {
  const last = isObject(info) && isObject(info.last_token_usage) ? (info.last_token_usage as Raw) : undefined
  const key = JSON.stringify(last ?? null)
  if (last === undefined || num(last.input_tokens) === 0 || key === s.lastCount) {
    return []
  }
  s.lastCount = key
  const { usage, context } = usageOf(last)
  const pending: Pending = { t0: startOf(s, t), t1: t, response: '', turn: s.turn ?? '', usage, context, tools: s.tools }
  s.tools = []
  s.lastT1 = t

  return [{ op: 'step', record: stepOf(s, pending) }]
}

/**
 * The operations of one rollout line, `state` moved on in place. `mode` is the resume guard's, for the messages that
 * resume a subagent. A line that is not JSON, or of a kind the meter does not read, gives none.
 */
export function codexLine(state: CodexState, line: string, o: { mode?: GuardMode } = {}): CodexOp[] {
  const head = line.match(HEAD)
  if (head === null) {
    return []
  }
  const t = Date.parse(head[1]!)
  const type = head[2]!
  const sub = head[3]
  if (!Number.isFinite(t)) {
    return []
  }
  if (type === 'compacted') {
    const response = line.match(/"compaction_response_id":"([^"]+)"/)?.[1]
    const p = state.pending
    state.inputAt = t
    if (p !== undefined && p.response === response) {
      state.pending = undefined
      const record: EventRecord = { k: 'compact', t0: p.t0, t1: p.t1, thread: threadOf(state), trigger: 'unknown', before: p.context, usage: p.usage, stepsSeen: 0 }
      return [{ op: 'compaction', record, model: state.model || 'unknown', usage: p.usage }]
    }
    return [...settle(state), { op: 'event', record: { k: 'compact', t0: t, t1: t, thread: threadOf(state), trigger: 'unknown', stepsSeen: 0 } }]
  }
  const ops = settle(state)
  if (type === 'token_usage_record') {
    const p = parsed(line)
    if (p !== undefined && isObject(p.usage)) {
      const { usage, context } = usageOf(p.usage as Raw)
      state.usageRecords = true
      state.pending = { t0: startOf(state, t), t1: t, response: str(p.response_id) ?? '', turn: str(p.turn_id) ?? state.turn ?? '', usage, context, tools: state.tools }
      state.tools = []
      state.lastT1 = t
    }
    return ops
  }
  if (type === 'session_meta') {
    const p = parsed(line)
    return p === undefined ? ops : [...ops, ...metaOps(state, t, p)]
  }
  if (type === 'turn_context' || type === 'world_state') {
    state.inputAt = t
    if (type === 'turn_context') {
      const p = parsed(line)
      state.model = str(p?.model) ?? state.model
      state.effort = str(p?.effort) ?? state.effort
    }
    return ops
  }
  if (type === 'event_msg') {
    if (sub === 'task_started' || sub === 'user_message') {
      state.inputAt = t
    } else if (sub === 'task_complete' && threadOf(state) !== MAIN) {
      ops.push({ op: 'event', record: { k: 'agent-stop', t, thread: threadOf(state), agentType: state.own?.role ?? '' } })
    } else if (sub === 'thread_settings_applied') {
      const settings = parsed(line)?.thread_settings
      state.model = (isObject(settings) && str(settings.model)) || state.model
      state.effort = (isObject(settings) && str(settings.reasoning_effort)) || state.effort
    } else if (sub === 'token_count') {
      const p = parsed(line)
      ops.push(...quotaOps(state, t, p?.rate_limits))
      if (!state.usageRecords) {
        ops.push(...countOps(state, t, p?.info))
      }
    }
    return ops
  }
  if (type === 'response_item' && sub !== undefined) {
    if (INPUT_ITEMS.has(sub) || (sub === 'message' && INPUT_ROLES.has(line.match(ROLE)?.[1] ?? ''))) {
      state.inputAt = t
    } else if (CALLS.has(sub)) {
      const p = parsed(line)
      ops.push(...(p === undefined ? [] : callOps(state, t, p, o.mode ?? 'warn')))
    }
  }

  return ops
}

/** The operations a file's end still holds: its last request, when no line has come after it yet (a hook reads a tail). */
export const codexEnd = (state: CodexState): CodexOp[] => settle(state)

/** Adds one file's operations to its session's collector, in place: steps, events, compactions, and agent paths. */
export function applyCodexOps(c: Collector, ops: readonly CodexOp[]) {
  for (const o of ops) {
    if (o.op === 'step') {
      addStep(c, o.record)
    } else if (o.op === 'event') {
      addEvent(c, o.record)
    } else if (o.op === 'compaction') {
      addEvent(c, o.record)
      addCompaction(c, o.record.thread, o.model, o.usage)
    } else if (o.path !== undefined) {
      c.names[o.path] = o.thread
      const up = o.path.slice(0, o.path.lastIndexOf('/'))
      if (up !== '' && o.parent !== undefined) {
        c.names[up] = o.parent === o.session ? MAIN : o.parent
      }
    }
  }
  c.dirty = ops.length > 0 || c.dirty
}

/**
 * Turns the agent paths in new agents and follow-ups into the threads they name, once their files are in, and judges each
 * follow-up as the resume guard would have: whether the subagent sat `coldAfterMin` or more with `coldTokens` or more.
 */
export function resolveCodex(c: Collector, o: { coldAfterMin: number; coldTokens: number }) {
  const resolved = (to: string) => (to.startsWith('/') ? c.names[to] : undefined)
  c.records = c.records.map(r => {
    if (r.k === 'agent-call' && r.agent !== undefined && resolved(r.agent) !== undefined) {
      return { ...r, agent: resolved(r.agent)! }
    }
    if (r.k !== 'send' || resolved(r.to) === undefined) {
      return r
    }
    const to = resolved(r.to)!
    const last = c.records.findLast(s => s.k === 'step' && s.thread === to && s.t0 <= r.t)
    if (last?.k !== 'step') {
      return { ...r, to }
    }
    const gapMs = r.t - last.t0

    return { ...r, to, risk: gapMs >= o.coldAfterMin * 60000 && last.ctx >= o.coldTokens, gapMs, ctx: last.ctx }
  })
  for (const r of c.records) {
    if (r.k === 'agent-call' && r.agent !== undefined && r.agentType !== undefined && !r.agent.startsWith('/')) {
      c.agentTypes[r.agent] ??= r.agentType
    }
  }
}
