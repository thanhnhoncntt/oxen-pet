import { summarize } from './analyze'
import type { Summary, SummaryOptions } from './analyze'
import { MAIN } from './record'
import type { Group, MeterRecord } from './record'
import type { SessionFile } from './sessionFile'
import type { TimingSummary } from './timing'

/**
 * `/meter export`: the sessions of the last days in one file a user sends to whoever builds the team report
 * (`tools/meter/aggregate.mjs`). Each session goes by a hash of its id; agent and turn ids become `a1`, `t1` within it;
 * MCP tools become `mcp` (a server's name can say what a team uses); times count from the session's start, which
 * keeps only its day. The project is as the session file has it: a salted hash unless the user turned that off.
 */

export const EXPORT_KIND = 'oxen-meter-export'
/** Under `$.fs.write`'s 4 MiB, with room. */
export const MAX_EXPORT_BYTES = 3.5 * 1024 * 1024

export type ExportSession = {
  id: string
  project: string
  startedDay: string // YYYY-MM-DD, UTC
  costUsd?: number
  dropped: number
  groups: Record<string, Group>
  timings: Record<string, TimingSummary>
  records?: MeterRecord[]
  recordsLeftOut?: true // left out to keep the file under its size limit; the groups still count them
}

export type ExportFile = {
  kind: typeof EXPORT_KIND
  v: 1
  label: string // the user's label, or anonymous
  version: string
  day: string // the day it was made, YYYY-MM-DD
  days: number
  settings: SummaryOptions
  summary: Summary
  sessions: ExportSession[]
}

const isMcp = (tool: string) => tool.startsWith('mcp__')

/** `records` of one session with its agents as `a1`, `a2`, its turns as `t1`, `t2`, MCP tools as `mcp`, and times from `startedAt`. */
export function anonymizeRecords(records: readonly MeterRecord[], startedAt: number): MeterRecord[] {
  const agents = new Map<string, string>()
  const turns = new Map<string, string>()
  const agent = (id: string) => {
    if (id === MAIN) {
      return MAIN
    }
    if (!agents.has(id)) {
      agents.set(id, `a${agents.size + 1}`)
    }
    return agents.get(id)!
  }
  const turn = (id: string) => {
    if (!turns.has(id)) {
      turns.set(id, `t${turns.size + 1}`)
    }
    return turns.get(id)!
  }
  const at = (t: number) => t - startedAt

  return records.map((r): MeterRecord => {
    switch (r.k) {
      case 'step':
        return { ...r, thread: agent(r.thread), turn: turn(r.turn), t0: at(r.t0), t1: at(r.t1), tools: r.tools.map(t => (isMcp(t) ? 'mcp' : t)) }
      case 'agent-call':
        return { ...r, thread: agent(r.thread), ...(r.agent !== undefined ? { agent: agent(r.agent) } : {}), t0: at(r.t0), t1: at(r.t1) }
      case 'codex':
      case 'compact':
        return { ...r, thread: agent(r.thread), t0: at(r.t0), t1: at(r.t1) }
      case 'send':
        return { ...r, thread: agent(r.thread), to: agent(r.to), t: at(r.t) }
      default:
        return { ...r, thread: agent(r.thread), t: at(r.t) }
    }
  })
}

const dayOf = (t: number) => new Date(t).toISOString().slice(0, 10)

/** The export of `sessions`, each with the id it goes by, oldest first, and their summary. */
export function exportOf(sessions: readonly { file: SessionFile; id: string }[], o: { label: string; version: string; day: string; days: number; settings: SummaryOptions }): ExportFile {
  const out = [...sessions]
    .sort((a, b) => a.file.startedAt - b.file.startedAt)
    .map(({ file, id }): ExportSession => ({
      id,
      project: file.project,
      startedDay: dayOf(file.startedAt),
      ...(file.costUsd !== undefined ? { costUsd: file.costUsd } : {}),
      dropped: file.dropped,
      groups: file.groups,
      timings: file.timings,
      records: anonymizeRecords(file.records, file.startedAt),
    }))
  const summary = summarize(
    out.map(s => ({ sid: s.id, startedAt: 0, records: s.records ?? [], groups: s.groups })),
    o.settings,
  )

  return { kind: EXPORT_KIND, v: 1, label: o.label || 'anonymous', version: o.version, day: o.day, days: o.days, settings: o.settings, summary, sessions: out }
}

const bytes = (text: string) => new TextEncoder().encode(text).length

/** The export as text, at most `maxBytes`: the records of its oldest sessions are left out first. */
export function exportText(e: ExportFile, maxBytes = MAX_EXPORT_BYTES): string {
  const sessions = [...e.sessions]
  for (let i = 0; ; i++) {
    const text = JSON.stringify({ ...e, sessions })
    if (bytes(text) <= maxBytes || i >= sessions.length) {
      return text
    }
    const { records: _left, ...rest } = sessions[i]!
    sessions[i] = { ...rest, recordsLeftOut: true }
  }
}
