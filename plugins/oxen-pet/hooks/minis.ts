import type { AgentInfo } from 'claude-code'

import type { MiniView } from './pixels'

/** A subagent's mini: it joins when the agent starts and leaves `LEAVE_MS` after the agent ends. */
export type Mini = { id: string; since: number; doneAt?: number; failed?: boolean }

const LEAVE_MS = 1500

const ALIVE = new Set(['running', 'pending'])

/** The minis after a look at the session's agents at time `t`. */
export function reconcile(minis: Mini[], agents: AgentInfo[], t: number): Mini[] {
  const byId = new Map(agents.map(a => [a.id, a]))
  const kept = minis.flatMap((m): Mini[] => {
    if (m.doneAt !== undefined) {
      return t - m.doneAt < LEAVE_MS ? [m] : []
    }
    const a = byId.get(m.id)
    if (a && ALIVE.has(a.status)) {
      return [m]
    }

    // An agent gone from the list counts as finished, not failed.
    return [{ ...m, doneAt: t, failed: a !== undefined && a.status !== 'completed' }]
  })
  const known = new Set(minis.map(m => m.id))
  const born = agents.filter(a => ALIVE.has(a.status) && !known.has(a.id)).map(a => ({ id: a.id, since: t }))

  return [...kept, ...born]
}

/** The minis to draw at time `t`, as compose takes them: every running one, and every one that ended under `LEAVE_MS` ago. */
export function minisOnScreen(minis: Mini[], t: number): MiniView[] {
  return minis
    .filter(m => m.doneAt === undefined || t - m.doneAt < LEAVE_MS)
    .map(m => ({ age: t - m.since, doneFor: m.doneAt === undefined ? undefined : t - m.doneAt, failed: m.failed }))
}
