import { RECORD_KINDS, TOOLS, newCollector, noteAgentType, noteThread } from './record'
import type { Collector, Group, MeterRecord, Tool } from './record'
import { timingSummary } from './timing'
import type { TimingSummary } from './timing'

/**
 * A session's file in the data folder's `sessions/`: what the meter knew of the session when it last wrote, whole.
 * `$.fs.write` writes a whole file and nothing deletes one, so the file is written over each time, kept under a size
 * limit by dropping its oldest steps, and an expired one is written over with a tombstone.
 */

export const FILE_VERSION = 1
/** Under `$.fs.write`'s 4 MiB, with room. */
export const MAX_BYTES = 3 * 1024 * 1024
/** What an expired session file is written over with. */
export const TOMBSTONE = '{"v":1,"expired":true}'

export type SessionMeta = {
  sid: string
  project: string // a hash of the project folder's name, or the name when the user turned hashing off
  startedAt: number
  savedAt: number
  version: string // the meter's version that wrote the file
  settings: { mainTtl: string; subagentTtl: string; coldTokens: number; outputWeight: number; cachedWeight?: number }
  costUsd?: number // what the session had cost, as /cost totals it
  tool?: Tool // the tool the session ran in; none in a file of 1.0.0, which only Claude Code wrote
}

export type SessionFile = SessionMeta & {
  v: typeof FILE_VERSION
  dropped: number
  groups: Record<string, Group>
  names: Record<string, string>
  timings: Record<string, TimingSummary>
  records: MeterRecord[]
}

const bytes = (text: string) => new TextEncoder().encode(text).length

/** The session's file as text, at most `maxBytes`: its oldest steps go first when it would be larger. */
export function sessionText(c: Collector, meta: SessionMeta, maxBytes = MAX_BYTES): string {
  const timings = Object.fromEntries(Object.entries(c.timings).map(([hook, t]) => [hook, timingSummary(t)]))
  let records = c.records
  let dropped = c.dropped
  for (;;) {
    const file: SessionFile = { v: FILE_VERSION, ...meta, dropped, groups: c.groups, names: c.names, timings, records }
    const text = JSON.stringify(file)
    const size = bytes(text)
    const steps = records.filter(r => r.k === 'step').length
    if (size <= maxBytes || steps === 0) {
      return text
    }
    // Drop the share of steps the file is over by, and a little more, so it fits in a few passes.
    let drop = Math.max(1, Math.ceil(steps * ((size - maxBytes) / size) * 1.1))
    dropped += drop
    records = records.filter(r => !(r.k === 'step' && drop-- > 0))
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** A session file from its text, or undefined for a tombstone, a file that is not JSON, or one of another shape. */
export function readSessionText(text: string): SessionFile | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  if (!isObject(parsed) || parsed.v !== FILE_VERSION || typeof parsed.sid !== 'string' || !Array.isArray(parsed.records) || !isObject(parsed.groups)) {
    return undefined
  }
  const records = parsed.records.filter((r): r is MeterRecord => isObject(r) && typeof r.k === 'string' && RECORD_KINDS.has(r.k))
  const { tool, ...rest } = parsed as SessionFile

  return {
    ...rest,
    ...((TOOLS as readonly unknown[]).includes(tool) ? { tool } : {}),
    dropped: typeof parsed.dropped === 'number' ? parsed.dropped : 0,
    names: isObject(parsed.names) ? (parsed.names as Record<string, string>) : {},
    timings: isObject(parsed.timings) ? (parsed.timings as Record<string, TimingSummary>) : {},
    records,
  }
}

/** A collector that goes on from a file: its records and totals, its threads, agent types and names. */
export function restoreCollector(file: SessionFile): Collector {
  const c = newCollector()
  c.records = [...file.records]
  c.dropped = file.dropped
  c.groups = structuredClone(file.groups)
  c.names = { ...file.names }
  for (const r of c.records) {
    if (r.k === 'step') {
      noteThread(c, r)
    } else {
      noteAgentType(c, r)
    }
  }

  return c
}

export const isExpired = (mtimeMs: number, now: number, retentionDays: number) => now - mtimeMs > retentionDays * 86400000
