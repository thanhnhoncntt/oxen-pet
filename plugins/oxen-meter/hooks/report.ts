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
const agentLabel = (id: string, type: string | undefined) => `${type ?? 'agent'} ${id.replace(/[^A-Za-z0-9]/g, '').slice(-4)}`

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

/** The pane's rows at `now`: the cache over every step, the steps by role, each live thread, and the meter's own hook times. */
export function paneRows(c: Collector, live: readonly LiveAgent[], now: number, ttlMin: { main: number; subagent: number }): Row[] {
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
  if (c.threads[MAIN]) {
    rows.push(threadRow('main', c, MAIN, now, ttlMin.main))
  }
  for (const a of live) {
    if (!ENDED.has(a.status)) {
      rows.push(threadRow(agentLabel(a.id, c.agentTypes[a.id]), c, a.id, now, ttlMin.subagent))
    }
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
