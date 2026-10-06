import { writeWeight } from './analyze'
import { MAIN } from './record'
import type { Collector, ThreadState } from './record'
import { fmtDur, fmtTokens } from './report'

/**
 * The cold resume guard's judgement: whether waking a thread now writes its whole context to the cache again, who a
 * message goes to, and what the user and Claude are told. `register.tsx` asks before a SendMessage resumes an agent
 * (`session.send`), and warns when a thread wakes on its own (`turn.step`).
 */

/** A resume that likely finds the cache cold: how long the thread sat, how much it holds, its TTL, and what writing it again costs beyond a read. */
export type ResumeRisk = { gapMs: number; ctx: number; ttlMin: number; extra: number }

/** From nine tenths of the TTL on: the cache may lapse before the request reaches it. */
const RISK_SHARE = 0.9
const READ_WEIGHT = 0.1

export const RESUME_OPTIONS = { fresh: 'Spawn a fresh agent', resume: 'Resume anyway' } as const

/**
 * The risk of waking `thread` at `now`, or undefined when its cache is likely warm or its context small. `share` of
 * the TTL is where the risk starts: nine tenths before a resume the user can still stop, the whole TTL for a thread
 * already waking.
 */
export function resumeRisk(thread: ThreadState | undefined, now: number, ttlMin: number, coldTokens: number, share = RISK_SHARE): ResumeRisk | undefined {
  if (thread === undefined) {
    return undefined
  }
  const gapMs = now - thread.lastT0
  if (gapMs < ttlMin * 60000 * share || thread.lastCtx < coldTokens) {
    return undefined
  }

  return { gapMs, ctx: thread.lastCtx, ttlMin, extra: Math.round(thread.lastCtx * (writeWeight(ttlMin) - READ_WEIGHT)) }
}

/**
 * The thread a message `to` goes to: an agent id the meter has seen or that is alive, the name an Agent call gave an
 * agent, or a name exactly one live agent has. `main` is the main thread. Anything else (another session, a teammate
 * the meter cannot place, a name two agents share) is undefined.
 */
export function resolveRecipient(to: string, c: Collector, live: readonly { id: string; name?: string }[]): string | undefined {
  if (to === MAIN || c.threads[to] !== undefined || live.some(a => a.id === to)) {
    return to
  }
  if (c.names[to] !== undefined) {
    return c.names[to]
  }
  const named = live.filter(a => a.name === to)

  return named.length === 1 ? named[0]!.id : undefined
}

const ttlName = (min: number) => (min >= 60 ? '1h' : '5m')

export const resumeQuestion = (r: ResumeRisk, label: string) =>
  `oxen-meter: ${label} has sat ${fmtDur(r.gapMs)}, past its ${ttlName(r.ttlMin)} cache. Resuming it writes its ${fmtTokens(r.ctx)} context again: about ${fmtTokens(r.extra)} token equivalents. Spawn a fresh agent with a short handoff instead?`

export const resumeToast = (r: ResumeRisk, label: string) => `oxen-meter: resuming ${label} after ${fmtDur(r.gapMs)} writes its ${fmtTokens(r.ctx)} context again (~${fmtTokens(r.extra)} eq).`

export const coldStartText = (r: ResumeRisk, label: string) => `oxen-meter: ${label} woke after ${fmtDur(r.gapMs)} with a cold cache: writing ${fmtTokens(r.ctx)} context again (~${fmtTokens(r.extra)} eq).`

/** What Claude reads when the user refuses the resume: the message was not sent, and what to do instead. */
export const freshReason = (r: ResumeRisk, label: string) =>
  `The user chose not to resume ${label}: its prompt cache went cold ${fmtDur(r.gapMs)} ago, and resuming it would write its ${fmtTokens(r.ctx)} context again. The message was not sent. Spawn a fresh agent instead, with a short handoff: the task, what ${label} found or changed, and what is left to do.`
