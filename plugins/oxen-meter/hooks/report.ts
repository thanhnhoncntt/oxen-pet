import { hitRate } from './analyze'
import type { ColdResume, Handoff, Summary, TtlView } from './analyze'
import { MAIN } from './record'
import type { Collector } from './record'
import { timingRows } from './timing'

/** One row of the pane: a label, its value, and a color when the row has a state (warm, cooling, cold). */
export type Row = { label: string; value: string; color?: string }

/** An agent as `$.agent.list()` gives it, as much as the pane needs. */
export type LiveAgent = { id: string; status: string }

/** Mid tones, so each reads on a dark terminal and a light one. */
export const COLORS = { warm: '#3fa66b', cooling: '#c98a12', cold: '#d1495b', label: '#5aa9ff', detail: '#8b93b8' }

const ENDED = new Set(['completed', 'failed', 'killed'])
const COOLING_SHARE = 0.2 // the cache counts as cooling in the last fifth of its TTL
const MIN = 60000

export function fmtTokens(n: number) {
  if (n >= 1e7) {
    return `${Math.round(n / 1e6)}M`
  }
  if (n >= 1e6) {
    return `${(n / 1e6).toFixed(1)}M`
  }
  if (n >= 1e4) {
    return `${Math.round(n / 1e3)}K`
  }

  return n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(Math.round(n))
}

export function fmtMin(min: number) {
  return min < 60 ? `${min}m` : `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}m`
}

/** A model id without its `claude-` prefix and its date. */
export const shortModel = (model: string) => model.replace(/^claude-/, '').replace(/-\d{8}$/, '')

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0)

/** A subagent's label: its type, or `agent`, and the last four letters or digits of its id. */
export const agentLabel = (id: string, type: string | undefined) => `${type ?? 'agent'} ${id.replace(/[^A-Za-z0-9]/g, '').slice(-4)}`

/** A thread's label: `main`, or its agent's. */
export const threadLabel = (thread: string, c: Collector) => (thread === MAIN ? 'main' : agentLabel(thread, c.agentTypes[thread]))

/** A thread's row: its model and context, how long since its cache was read, and how long the cache has left. */
function threadRow(label: string, c: Collector, id: string, now: number, ttlMin: number): Row {
  const t = c.threads[id]
  if (t === undefined) {
    return { label, value: 'no step yet' }
  }
  const idle = now - t.lastT0
  const left = ttlMin * MIN - idle
  const state = left <= 0 ? 'cold' : left <= ttlMin * MIN * COOLING_SHARE ? 'cooling' : 'warm'
  const cache = state === 'cold' ? 'cold' : `${state} ~${fmtMin(Math.ceil(left / MIN))}`

  return { label, value: `${shortModel(t.lastModel)} · ctx ${fmtTokens(t.lastCtx)} · read ${fmtMin(Math.floor(idle / MIN))} ago · ${cache}`, color: COLORS[state] }
}

/** What the pane adds once the meter has it: the session's summary, and where its file goes. */
export type PaneExtras = { summary?: Summary; files?: string }

/**
 * The pane's rows at `now`: the cache over every step, the steps by role, the token equivalent, TTLs and cold resumes,
 * each live thread, where the file goes, the handoffs and outcomes, and the meter's own hook times.
 */
export function paneRows(c: Collector, live: readonly LiveAgent[], now: number, ttlMin: { main: number; subagent: number }, more: PaneExtras = {}): Row[] {
  const groups = Object.entries(c.groups)
  if (groups.length === 0) {
    return [{ label: 'Cache', value: 'no model step yet' }]
  }
  const sum = { steps: 0, in: 0, out: 0, cr: 0, cw: 0, main: 0, subagent: 0 }
  for (const [key, g] of groups) {
    sum.steps += g.steps
    sum.in += g.in
    sum.out += g.out
    sum.cr += g.cr
    sum.cw += g.cw
    sum[key.startsWith('main|') ? 'main' : 'subagent'] += g.steps
  }
  const rows: Row[] = [
    { label: 'Cache', value: `hit ${pct(sum.cr, sum.cr + sum.cw + sum.in)}% · read ${fmtTokens(sum.cr)} · written ${fmtTokens(sum.cw)} · uncached ${fmtTokens(sum.in)} · output ${fmtTokens(sum.out)}` },
    { label: 'Steps', value: [sum.main > 0 ? `${sum.main} main` : '', sum.subagent > 0 ? `${sum.subagent} subagent` : ''].filter(Boolean).join(' · ') },
  ]
  const summary = more.summary
  if (summary) {
    rows.push({ label: 'Token eq.', value: eqText(summary) }, { label: 'TTL', value: ttlText(summary.ttl) })
    if (summary.cold.length > 0) {
      rows.push({ label: 'Cold', value: `${plural(summary.cold.length, 'cold resume')}: ${fmtTokens(summary.cold.reduce((n, r) => n + r.extra, 0))} eq beyond a read`, color: COLORS.cold })
    }
  }
  if (c.threads[MAIN]) {
    rows.push(threadRow('main', c, MAIN, now, ttlMin.main))
  }
  for (const a of live) {
    if (!ENDED.has(a.status)) {
      rows.push(threadRow(agentLabel(a.id, c.agentTypes[a.id]), c, a.id, now, ttlMin.subagent))
    }
  }
  if (more.files !== undefined) {
    rows.push({ label: 'Files', value: more.files })
  }

  return [...rows, ...eventRows(c), ...timingRows(c.timings).map(t => ({ label: t.hook, value: t.text }))]
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
const notes = (parts: string[]) => (parts.length > 0 ? ` (${parts.join(', ')})` : '')

/** The rows for what happened around the steps: handoffs to subagents and Codex, outcomes, compactions. */
function eventRows(c: Collector): Row[] {
  const n = { agent: 0, agentBg: 0, codex: 0, codexBg: 0, codexFailed: 0, commit: 0, pr: 0 }
  const compactions: string[] = []
  for (const r of c.records) {
    if (r.k === 'agent-call') {
      n.agent += 1
      n.agentBg += r.bg ? 1 : 0
    } else if (r.k === 'codex') {
      n.codex += 1
      n.codexBg += r.bg ? 1 : 0
      n.codexFailed += r.failed ? 1 : 0
    } else if (r.k === 'outcome') {
      n[r.outcome] += 1
    } else if (r.k === 'compact') {
      compactions.push(r.before !== undefined && r.after !== undefined ? `${fmtTokens(r.before)} → ${fmtTokens(r.after)}` : r.trigger)
    }
  }
  const rows: Row[] = []
  const handoffs = [
    n.agent > 0 ? `${n.agent} Agent${notes(n.agentBg > 0 ? [`${n.agentBg} background`] : [])}` : '',
    n.codex > 0 ? `${n.codex} Codex${notes([...(n.codexBg > 0 ? [`${n.codexBg} background`] : []), ...(n.codexFailed > 0 ? [`${n.codexFailed} failed`] : [])])}` : '',
  ].filter(Boolean)
  if (handoffs.length > 0) {
    rows.push({ label: 'Handoffs', value: handoffs.join(' · ') })
  }
  if (n.commit + n.pr > 0) {
    rows.push({ label: 'Outcomes', value: [n.commit > 0 ? plural(n.commit, 'commit') : '', n.pr > 0 ? `${n.pr} PR${n.pr === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ') })
  }
  if (compactions.length > 0) {
    rows.push({ label: 'Compactions', value: `${compactions.length}: ${compactions.slice(-3).join(', ')}` })
  }

  return rows
}

/** The rows as plain text, one `label: value` a line, for where no pane shows. */
export const rowsText = (rows: readonly Row[]) => rows.map(r => `${r.label}: ${r.value}`).join('\n')

const eqText = (s: Summary) => `${fmtTokens(s.eq)}: main ${fmtTokens(s.byRole.main.eq)} · subagent ${fmtTokens(s.byRole.subagent.eq)}`

/** How long `ms` is, in seconds under a minute, else as fmtMin does. */
export const fmtDur = (ms: number) => (ms < 60000 ? `${Math.round(ms / 1000)}s` : fmtMin(Math.round(ms / 60000)))

function ttlOne(t: TtlView) {
  const ttl = t.min >= 60 ? '1h' : '5m'
  if (t.source === 'setting') {
    return `${t.role} ${ttl} (setting)`
  }
  if (t.source === 'measured') {
    return `${t.role} ${ttl} (measured: ${t.measured['5m'] + t.measured['1h']})`
  }
  const seen = [
    t.warm > 0 ? `${t.warm} warm up to ${fmtDur(t.longestWarmMs ?? 0)}` : '',
    t.cold > 0 ? `${t.cold} cold from ${fmtDur(t.shortestColdMs ?? 0)}` : '',
  ].filter(Boolean)

  return `${t.role} ${ttl} (${t.source}: ${seen.length > 0 ? seen.join(', ') : 'no samples'})`
}

const ttlText = (ttl: Summary['ttl']) => `${ttlOne(ttl.main)} · ${ttlOne(ttl.subagent)}`

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length === 0 ? undefined : sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

const pad = (label: string) => label.padEnd(10)
const INDENT = ' '.repeat(11)

/** When `t` was, in UTC: the mod has no time zone to read. */
const utc = (t: number) => `${new Date(t).toISOString().slice(0, 16).replace('T', ' ')} UTC`

function coldLine(r: ColdResume) {
  const who = r.role === 'main' ? (r.model === '' ? 'main (resumed)' : `main  ${shortModel(r.model)}`) : `${agentLabel(r.thread, r.agentType)}  ${shortModel(r.model)}`

  return `${utc(r.t)}  ${who}  idle ${fmtDur(r.gapMs)}  wrote ${fmtTokens(r.cw)}  +${fmtTokens(r.extra)} eq`
}

function handoffText(all: readonly Handoff[]) {
  const part = (kind: Handoff['kind'], one: string, many: string) => {
    const own = all.filter(h => h.kind === kind)
    if (own.length === 0) {
      return ''
    }
    const bg = own.filter(h => h.bg).length
    const back = median(own.flatMap(h => (h.workMs !== undefined ? [h.workMs] : [])))
    return `${own.length} ${own.length === 1 ? one : many}${bg > 0 ? ` (${bg} background)` : ''}${back !== undefined ? `, median ${fmtDur(back)} back` : ''}`
  }
  const react = median(all.flatMap(h => (h.reactMs !== undefined ? [h.reactMs] : [])))

  return [part('agent', 'Agent', 'Agent'), part('codex', 'Codex', 'Codex'), part('resume', 'resume', 'resumes'), react !== undefined ? `next handoff median ${fmtDur(react)}` : ''].filter(Boolean).join(' · ')
}

const FLAG_NAMES = { 'context-bloat': 'context bloat', 'big-first-prefix': 'big first prefix', 'expensive-short': 'short task on an expensive model' } as const
const TOP_COLD = 5

/** `/meter report`: what `s` adds up to over the last `days`, one row a line, the cold resumes that cost most first. */
export function reportText(s: Summary, o: { days: number; skipped: number }): string {
  if (s.sessions === 0) {
    return `No session in the last ${plural(o.days, 'day')}.`
  }
  const byEq = <T extends { eq: number }>(rec: Record<string, T>) => Object.entries(rec).sort((a, b) => b[1].eq - a[1].eq)
  const lines = [
    `${plural(s.sessions, 'session')} in the last ${plural(o.days, 'day')}${o.skipped > 0 ? ` (${plural(o.skipped, 'emptied file')} skipped)` : ''}`,
    `${pad('Cache')} hit ${pct(s.totals.cr, s.totals.cr + s.totals.cw + s.totals.in)}% · read ${fmtTokens(s.totals.cr)} · written ${fmtTokens(s.totals.cw)} · uncached ${fmtTokens(s.totals.in)} · output ${fmtTokens(s.totals.out)}`,
    `${pad('Token eq.')} ${eqText(s)}`,
    `${pad('Models')} ${byEq(s.byModel).map(([m, g]) => `${shortModel(m)} hit ${Math.round(hitRate(g) * 100)}%, ${fmtTokens(g.eq)} eq`).join(' · ')}`,
    `${pad('Agents')} ${byEq(s.byAgentType).map(([a, g], i) => `${a} ${fmtTokens(g.eq)}${i === 0 ? ' eq' : ''}`).join(' · ')}`,
    `${pad('TTL')} ${ttlText(s.ttl)}`,
  ]
  if (s.cold.length > 0) {
    const written = s.cold.reduce((n, r) => n + r.cw, 0)
    const extra = s.cold.reduce((n, r) => n + r.extra, 0)
    lines.push(`${pad('Cold')} ${plural(s.cold.length, 'cold resume')}: ${fmtTokens(written)} written again, ${fmtTokens(extra)} eq beyond a read`)
    for (const r of [...s.cold].sort((a, b) => b.extra - a.extra).slice(0, TOP_COLD)) {
      lines.push(`${INDENT}${coldLine(r)}`)
    }
  }
  const handoffs = handoffText(s.handoffs)
  if (handoffs !== '') {
    lines.push(`${pad('Handoffs')} ${handoffs}`)
  }
  const flags = (Object.keys(FLAG_NAMES) as (keyof typeof FLAG_NAMES)[]).flatMap(k => {
    const n = s.flags.filter(f => f.kind === k).length
    return n > 0 ? [`${n} ${FLAG_NAMES[k]}`] : []
  })
  if (flags.length > 0) {
    lines.push(`${pad('Flags')} ${flags.join(' · ')}`)
  }

  return lines.join('\n')
}

/** Where the session's file goes, as the meter last wrote it. */
export type FilesState = { root: string | undefined; savedAt?: number; error?: string }

/** The pane's files row: where the session is saved, or why it is not. */
export function filesText(f: FilesState, now: number) {
  if (f.root === undefined) {
    return 'not saved: set Data folder in /plugin configure oxen-meter@oxen-pet'
  }
  if (f.error !== undefined) {
    return `not saved: ${f.error}`
  }

  return f.savedAt === undefined ? `not saved yet: ${f.root}/sessions` : `saved ${fmtMin(Math.floor((now - f.savedAt) / MIN))} ago to ${f.root}/sessions`
}
