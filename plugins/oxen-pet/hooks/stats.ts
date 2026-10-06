import type { Hud } from './hud'
import { fmtMin } from './hud'
import { toolMode } from './status'
import type { ToolMode } from './status'
import type { TestOutcome } from './boss'

/** What the session did, as the hooks saw it, for the `/pet` pane. Files are kept as paths and shown as counts. */
export type Stats = {
  startedAt: number
  turns: number
  tools: Partial<Record<ToolMode, number>>
  failed: number
  read: string[]
  edited: string[]
  tests: { passed: number; failed: number }
  bosses: number // defeated
  shield: { blocked: number; ran: number }
  firstMp?: { left: number; at: number } // MP's first reading in its window, for the burn rate
}

/** One row of the pane: a label and its value. */
export type StatsRow = { label: string; value: string }

const MODE_ORDER: ToolMode[] = ['read', 'search', 'edit', 'bash', 'web', 'agent']
const EDITS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit'])
const MAX_FILES = 1000
const MAX_NAMES = 4
const BURN_AFTER_MIN = 15 // MP's burn rate is noise before this long

export const newStats = (t: number): Stats => ({ startedAt: t, turns: 0, tools: {}, failed: 0, read: [], edited: [], tests: { passed: 0, failed: 0 }, bosses: 0, shield: { blocked: 0, ran: 0 } })

const withFile = (files: string[], path: unknown) => (typeof path === 'string' && path !== '' && !files.includes(path) && files.length < MAX_FILES ? [...files, path] : files)

/** The stats after one tool call of `tool` with `input`, which `failed` or not. */
export function recordTool(s: Stats, tool: string, input: Record<string, unknown>, failed: boolean): Stats {
  const mode = toolMode(tool)
  const path = input.file_path ?? input.notebook_path

  return {
    ...s,
    tools: { ...s.tools, [mode]: (s.tools[mode] ?? 0) + 1 },
    failed: s.failed + (failed ? 1 : 0),
    read: tool === 'Read' ? withFile(s.read, path) : s.read,
    edited: EDITS.has(tool) ? withFile(s.edited, path) : s.edited,
  }
}

export const recordTurn = (s: Stats): Stats => ({ ...s, turns: s.turns + 1 })

export const recordTest = (s: Stats, outcome: TestOutcome, beatBoss: boolean): Stats => ({
  ...s,
  tests: { ...s.tests, [outcome]: s.tests[outcome] + 1 },
  bosses: s.bosses + (beatBoss ? 1 : 0),
})

export const recordShield = (s: Stats, result: 'blocked' | 'ran'): Stats => ({ ...s, shield: { ...s.shield, [result]: s.shield[result] + 1 } })

/** The stats after an MP reading of `left` at `t`: the first one in its window starts the burn rate. A reset, MP climbing, starts it over. */
export const noteMp = (s: Stats, left: number, t: number): Stats => (s.firstMp === undefined || left > s.firstMp.left ? { ...s, firstMp: { left, at: t } } : s)

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
const names = (paths: string[]) => {
  const shown = paths.slice(0, MAX_NAMES).map(p => p.split(/[\\/]/).pop())
  return `${shown.join(', ')}${paths.length > MAX_NAMES ? ', …' : ''}`
}

/** The pane's rows at `now`: only what the session did, and file names only when `showNames`. */
export function statsRows(s: Stats, now: number, hud: Hud | undefined, showNames: boolean): StatsRow[] {
  const rows: StatsRow[] = [{ label: 'Session', value: `${fmtMin(Math.max(0, Math.floor((now - s.startedAt) / 60000)))} · ${plural(s.turns, 'turn')}` }]
  const calls = MODE_ORDER.reduce((n, m) => n + (s.tools[m] ?? 0), 0)
  if (calls > 0) {
    const parts = MODE_ORDER.filter(m => s.tools[m]).map(m => `${s.tools[m]} ${m}`)
    rows.push({ label: 'Tools', value: `${plural(calls, 'call')}: ${[...parts, ...(s.failed > 0 ? [`${s.failed} failed`] : [])].join(' · ')}` })
  }
  if (s.read.length + s.edited.length > 0) {
    const read = s.read.length > 0 ? [`${s.read.length} read`] : []
    const edited = s.edited.length > 0 ? [`${s.edited.length} edited${showNames ? `: ${names(s.edited)}` : ''}`] : []
    rows.push({ label: 'Files', value: [...read, ...edited].join(' · ') })
  }
  if (s.tools.agent) {
    rows.push({ label: 'Subagents', value: String(s.tools.agent) })
  }
  const runs = s.tests.passed + s.tests.failed
  if (runs > 0) {
    const beaten = s.bosses > 0 ? [`${s.bosses} boss${s.bosses === 1 ? '' : 'es'} beaten`] : []
    rows.push({ label: 'Tests', value: `${plural(runs, 'run')}: ${[`${s.tests.passed} passed`, `${s.tests.failed} failed`, ...beaten].join(' · ')}` })
  }
  const asked = s.shield.blocked + s.shield.ran
  if (asked > 0) {
    rows.push({ label: 'Shield', value: `${asked} asked: ${s.shield.blocked} blocked · ${s.shield.ran} ran` })
  }
  if (hud) {
    const hours = s.firstMp ? (now - s.firstMp.at) / 3600000 : 0
    const burn = s.firstMp && hud.mp !== undefined && hours * 60 >= BURN_AFTER_MIN ? [`MP ${Math.round((s.firstMp.left - hud.mp) / hours)}%/h`] : []
    rows.push({ label: 'Burn', value: [...burn, `context ${100 - hud.hp}% used`].join(' · ') })
  }

  return rows
}
