import { MAIN, addCompaction, addEvent, addStep } from './record'
import type { Collector, EventRecord, StepRecord, Usage } from './record'

/**
 * Devin CLI's sessions (`~/.local/share/devin/cli/sessions.db`) as the meter's records. The CLI's query hands this
 * module each node of a session's tree with its metadata alone, never a message's text: the node and its parent, the
 * role, the request's id, model, times, token counts and label, the names of the tools it called, and on the first node
 * of a subagent's chain, the subagent's id and profile.
 *
 * A request belongs to the chain it hangs from: the main thread's, or a subagent's, whose first node is a system message
 * naming it. A compaction copies requests onto the new chain under the same request id; each counts once. The
 * `compactor` model's requests are compactions, and a request labelled `cache_keepalive` is a keepalive: Devin pings
 * the cache every few minutes to keep it warm. Devin reports the uncached input apart from the cache's read and write;
 * a model that reports no write (SWE) gives none.
 */

export type DevinRow = {
  node: number
  parent: number | null
  role?: string | null
  req?: string | null
  model?: string | null
  t0?: string | null // when the request went
  t1?: string | null // when the node was made: the response's end
  label?: string | null
  inp?: number | null
  cr?: number | null
  cw?: number | null
  out?: number | null
  tools?: string | null // the names of the tools it called, comma-separated
  agent?: string | null // a subagent's id, on the first node of its chain
  profile?: string | null
  user?: number | null // 1 on a message the user typed
}

export type DevinRecords = { steps: StepRecord[]; events: EventRecord[]; compactions: { thread: string; model: string; usage: Usage }[] }

const COMPACTOR = 'compactor'
const KEEPALIVE = 'cache_keepalive'
const HANDOFF_TOOLS = new Set(['run_subagent', 'sidekick'])
/** A subagent's chain starting this long before its call ended is still that call's. */
const HANDOFF_SLACK_MS = 5000

const timeOf = (iso: string | null | undefined) => (typeof iso === 'string' ? Date.parse(iso) : Number.NaN)
const count = (n: number | null | undefined) => (typeof n === 'number' && Number.isFinite(n) ? n : 0)

/** The records of one session's nodes, in the order the database keeps them. */
export function devinRecords(rows: readonly DevinRow[]): DevinRecords {
  const byNode = new Map(rows.map(r => [r.node, r]))
  const threadOf = new Map<number, string>()
  const subagents = new Map<string, { type: string; start: number }>()
  /** The thread a node hangs from: the first subagent root above it, else main. */
  const thread = (start: number): string => {
    const path: number[] = []
    let found = MAIN
    for (let n = byNode.get(start); n !== undefined; n = n.parent === null ? undefined : byNode.get(n.parent)) {
      const known = threadOf.get(n.node)
      if (known !== undefined) {
        found = known
        break
      }
      if (n.role === 'system' && typeof n.agent === 'string' && n.agent !== '') {
        found = `${n.agent}-${n.node}`
        subagents.set(found, { type: n.profile ?? n.agent, start: timeOf(n.t1) })
        break
      }
      if (path.length > rows.length) {
        break
      }
      path.push(n.node)
    }
    for (const id of path) {
      threadOf.set(id, found)
    }
    return found
  }

  type Ask = { row: DevinRow; t0: number; t1: number; thread: string; usage: Usage }
  const seen = new Set<string>()
  const asks: Ask[] = []
  for (const r of rows) {
    const t0 = timeOf(r.t0)
    const t1 = timeOf(r.t1)
    if (typeof r.req !== 'string' || seen.has(r.req) || !Number.isFinite(t0) || typeof r.inp !== 'number') {
      continue
    }
    seen.add(r.req)
    asks.push({ row: r, t0, t1: Number.isFinite(t1) ? t1 : t0, thread: thread(r.node), usage: { in: count(r.inp), cr: count(r.cr), cw: count(r.cw), out: count(r.out) } })
  }
  asks.sort((a, b) => a.t0 - b.t0)
  const users = rows.filter(r => r.role === 'user' && r.user === 1).map(r => timeOf(r.t1)).filter(Number.isFinite).sort((a, b) => a - b)

  const steps: StepRecord[] = []
  const events: EventRecord[] = []
  const compactions: DevinRecords['compactions'] = []
  const last: Record<string, number> = {}
  const idx: Record<string, number> = {}
  for (const a of asks) {
    const model = a.row.model ?? 'unknown'
    if (model === COMPACTOR) {
      compactions.push({ thread: a.thread, model, usage: a.usage })
      events.push({ k: 'compact', t0: a.t0, t1: a.t1, thread: a.thread, trigger: 'unknown', before: a.usage.in + a.usage.cr + a.usage.cw, usage: a.usage, stepsSeen: 0 })
      continue
    }
    const turn = `u${users.filter(t => t <= a.t0).length}`
    const key = `${a.thread}|${turn}`
    const gapMs = last[a.thread] === undefined ? undefined : a.t0 - last[a.thread]!
    last[a.thread] = a.t0
    const agentType = a.thread === MAIN ? undefined : subagents.get(a.thread)?.type
    steps.push({
      k: 'step',
      t0: a.t0,
      t1: a.t1,
      turn,
      idx: (idx[key] = (idx[key] ?? -1) + 1),
      thread: a.thread,
      ...(agentType !== undefined ? { agentType } : {}),
      model,
      ...a.usage,
      ctx: a.usage.in + a.usage.cr + a.usage.cw,
      ...(gapMs !== undefined ? { gapMs } : {}),
      msgs: 0,
      tools: (a.row.tools ?? '').split(',').filter(Boolean),
      ...(a.row.label === KEEPALIVE ? { keepalive: true as const } : {}),
    })
  }

  const unmatched = [...subagents.entries()].sort((a, b) => a[1].start - b[1].start)
  for (const s of steps) {
    if (!s.tools.some(t => HANDOFF_TOOLS.has(t))) {
      continue
    }
    const i = unmatched.findIndex(([, sub]) => sub.start >= s.t1 - HANDOFF_SLACK_MS)
    if (i >= 0) {
      const [agent, sub] = unmatched.splice(i, 1)[0]!
      events.push({ k: 'agent-call', t0: s.t1, t1: s.t1, thread: s.thread, agent, agentType: sub.type, status: 'started', bg: true })
    }
  }
  for (const [agent, sub] of subagents) {
    const own = steps.filter(s => s.thread === agent)
    events.push({ k: 'agent-start', t: Number.isFinite(sub.start) ? sub.start : (own[0]?.t0 ?? 0), thread: agent, agentType: sub.type })
    if (own.length > 0) {
      events.push({ k: 'agent-stop', t: own.at(-1)!.t1, thread: agent, agentType: sub.type })
    }
  }
  events.sort((a, b) => ('t' in a ? a.t : a.t0) - ('t' in b ? b.t : b.t0))

  return { steps, events, compactions }
}

/** Adds a session's records to a collector, in place, in time order; the compactions to its totals. */
export function applyDevin(c: Collector, r: DevinRecords) {
  const all = [...r.events.map(e => ({ at: 't' in e ? e.t : e.t0, add: () => addEvent(c, e) })), ...r.steps.map(s => ({ at: s.t0, add: () => addStep(c, s) }))]
  for (const { add } of all.sort((a, b) => a.at - b.at)) {
    add()
  }
  for (const x of r.compactions) {
    addCompaction(c, x.thread, x.model, x.usage)
  }
}
