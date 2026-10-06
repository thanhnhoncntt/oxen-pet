import { weightsOf } from './provider'
import type { Tool } from './record'
import { fmtDur, fmtTokens } from './report'

/**
 * The resume guard of the CLI's hooks, for the tools a Claude Code mod cannot reach. Codex and Devin have no fixed
 * cache TTL: a thread is at risk once it sat the Cold after minutes with at least the cold tokens of context.
 *
 * What a hook may answer differs from the mod's guard. A message a hook prints for the user (`systemMessage`) never
 * reaches the model. A prompt the user typed can be held back (`decision: block`), and the user sends it anyway with ↑
 * and Enter: the `ask` mode, once per idle spell. A tool call cannot be asked about (Codex 0.160.1 refuses
 * `permissionDecision: ask`), and a refusal would be read by the model, so a follow-up to a cold subagent is only
 * warned about, in `ask` mode too.
 */

export type GuardMode = 'off' | 'warn' | 'ask'
export type IdleRisk = { idleMs: number; ctx: number; extra: number }
/** What the hook prints: one JSON object, or nothing. */
export type HookAnswer = { systemMessage: string } | { decision: 'block'; reason: string }

const MIN = 60000

/** The risk of resuming a thread whose last request was `last` at `now`, or undefined when there is none. */
export function idleRisk(last: { t0: number; ctx: number; model: string } | undefined, now: number, o: { coldAfterMin: number; coldTokens: number; cachedWeight: number; tool?: Tool }): IdleRisk | undefined {
  if (last === undefined || now - last.t0 < o.coldAfterMin * MIN || last.ctx < o.coldTokens) {
    return undefined
  }
  const { w, rw } = weightsOf(o.tool ?? 'codex', last.model, 0, o.cachedWeight)

  return { idleMs: now - last.t0, ctx: last.ctx, extra: Math.round(last.ctx * (w - rw)) }
}

const cost = (r: IdleRisk) => `Its ${fmtTokens(r.ctx)} context is likely out of the cache, so this prompt sends it all again (~${fmtTokens(r.extra)} eq).`

/** The answer to a prompt the user typed into a thread at `risk`; `asked` when this idle spell was held back once already. */
export function promptAnswer(risk: IdleRisk | undefined, mode: GuardMode, asked: boolean): HookAnswer | undefined {
  if (risk === undefined || mode === 'off' || (mode === 'ask' && asked)) {
    return undefined
  }
  const head = `oxen-meter: this thread sat ${fmtDur(risk.idleMs)}. ${cost(risk)}`

  return mode === 'warn' ? { systemMessage: `${head} A fresh thread with a short summary costs less.` } : { decision: 'block', reason: `${head} Press ↑ and Enter to send it anyway, or start a fresh thread with a short summary.` }
}

/** The warning for a follow-up to the subagent `label` at `risk`, for the user alone. */
export function followUpWarning(risk: IdleRisk | undefined, mode: GuardMode, label: string): HookAnswer | undefined {
  if (risk === undefined || mode === 'off') {
    return undefined
  }

  return { systemMessage: `oxen-meter: ${label} sat ${fmtDur(risk.idleMs)}. Resuming it likely sends its ${fmtTokens(risk.ctx)} context again (~${fmtTokens(risk.extra)} eq); a fresh subagent with a short handoff costs less.` }
}
