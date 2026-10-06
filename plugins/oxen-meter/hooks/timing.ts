/**
 * How long the meter's own hooks take, by hook: every call counts toward the count, mean and max, and the last
 * `RING` calls give the 95th percentile. The hooks note into it in place, so the hot path allocates nothing.
 */
export type Timing = { count: number; totalMs: number; maxMs: number; ring: number[]; next: number }
export type Timings = Record<string, Timing>
export type TimingSummary = { count: number; meanMs: number; p95Ms: number; maxMs: number }

export const RING = 256

export const newTimings = (): Timings => ({})

const round3 = (n: number) => Math.round(n * 1000) / 1000

/** Notes one call of `hook` that took `ms`, in place. */
export function noteTiming(t: Timings, hook: string, ms: number) {
  const took = Number.isFinite(ms) && ms > 0 ? ms : 0
  const at = (t[hook] ??= { count: 0, totalMs: 0, maxMs: 0, ring: [], next: 0 })
  at.count += 1
  at.totalMs += took
  at.maxMs = Math.max(at.maxMs, took)
  if (at.ring.length < RING) {
    at.ring.push(took)
  } else {
    at.ring[at.next] = took
  }
  at.next = (at.next + 1) % RING
}

export function timingSummary(t: Timing): TimingSummary {
  const sorted = [...t.ring].sort((a, b) => a - b)
  const p95 = sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0

  return { count: t.count, meanMs: round3(t.count > 0 ? t.totalMs / t.count : 0), p95Ms: round3(p95), maxMs: round3(t.maxMs) }
}

/** One row per hook that ran, the slowest mean first. */
export function timingRows(t: Timings): { hook: string; text: string }[] {
  return Object.entries(t)
    .map(([hook, at]) => ({ hook, s: timingSummary(at) }))
    .sort((a, b) => b.s.meanMs - a.s.meanMs || a.hook.localeCompare(b.hook))
    .map(({ hook, s }) => ({ hook, text: `${s.meanMs.toFixed(2)} ms mean · p95 ${s.p95Ms.toFixed(2)} · max ${s.maxMs.toFixed(2)} · ${s.count} call${s.count === 1 ? '' : 's'}` }))
}
