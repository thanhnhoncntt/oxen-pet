import { expect, test } from 'claude-code/testing'

import { applyDevin, devinRecords } from './devinLog'
import type { DevinRow } from './devinLog'
import { MAIN, newCollector } from './record'

const MIN = 60000
const START = Date.UTC(2026, 8, 22, 9, 0)
const at = (ms: number) => new Date(START + ms).toISOString()

let node = 0
/** A node of a Devin session as the CLI's query returns it: metadata only, never a message's text. */
function row(parent: number | null, o: Partial<DevinRow> = {}): DevinRow {
  node += 1
  return { node, parent, role: 'assistant', ...o }
}
const ask = (parent: number | null, ms: number, model: string, inp: number, cr: number, cw: number | null, extra: Partial<DevinRow> = {}) =>
  row(parent, { req: `req-${node + 1}`, model, t0: at(ms), t1: at(ms + 3000), inp, cr, cw, out: 200, ...extra })

/**
 * A session: the main thread on Claude, three keepalive pings while the user is away, a compaction, a request copied
 * by the compaction (the same request id), and a Sidekick subagent started from a run_subagent call.
 */
function session(): DevinRow[] {
  node = 0
  const user = row(null, { role: 'user', user: 1, t1: at(0) })
  const a1 = ask(user.node, 500, 'claude-fable-5-1-medium', 4, 0, 40000, { tools: 'read,exec' })
  const a2 = ask(a1.node, 2 * MIN, 'claude-fable-5-1-medium', 4, 40000, 2000, { tools: 'run_subagent' })
  const subRoot = row(a2.node, { role: 'system', agent: 'sidekick', profile: 'Sidekick', t1: at(2 * MIN + 4000) })
  const s1 = ask(subRoot.node, 2 * MIN + 5000, 'swe-2-medium', 900, 0, null, { tools: 'grep' })
  const s2 = ask(s1.node, 3 * MIN, 'swe-2-medium', 300, 20000, null)
  const k1 = ask(a2.node, 2 * MIN + 285000, 'claude-fable-5-1-medium', 4, 42000, 4, { label: 'cache_keepalive', out: 1 })
  const k2 = ask(k1.node, 2 * MIN + 570000, 'claude-fable-5-1-medium', 4, 42000, 4, { label: 'cache_keepalive', out: 1 })
  const k3 = ask(k2.node, 2 * MIN + 855000, 'claude-fable-5-1-medium', 4, 42000, 4, { label: 'cache_keepalive', out: 1 })
  const c = ask(k3.node, 40 * MIN, 'compactor', 42000, 0, null, { out: 3000 })
  const copy = { ...a2, node: 99, parent: c.node }
  const a3 = ask(copy.node, 41 * MIN, 'claude-fable-5-1-medium', 4, 0, 6000)
  return [user, a1, a2, subRoot, s1, s2, k1, k2, k3, c, copy, a3]
}

test('each request is a step of its thread, by the chain it hangs from; a copy left by a compaction counts once', () => {
  const { steps } = devinRecords(session())
  expect(steps.map(s => [s.thread === MAIN ? MAIN : s.agentType, s.model, s.in, s.cr, s.cw, s.out, (s.t0 - START) / 1000])).toEqual([
    [MAIN, 'claude-fable-5-1-medium', 4, 0, 40000, 200, 0.5],
    [MAIN, 'claude-fable-5-1-medium', 4, 40000, 2000, 200, 120],
    ['Sidekick', 'swe-2-medium', 900, 0, 0, 200, 125],
    ['Sidekick', 'swe-2-medium', 300, 20000, 0, 200, 180],
    [MAIN, 'claude-fable-5-1-medium', 4, 42000, 4, 1, 405],
    [MAIN, 'claude-fable-5-1-medium', 4, 42000, 4, 1, 690],
    [MAIN, 'claude-fable-5-1-medium', 4, 42000, 4, 1, 975],
    [MAIN, 'claude-fable-5-1-medium', 4, 0, 6000, 200, 2460],
  ])
  expect(steps.map(s => s.keepalive === true)).toEqual([false, false, false, false, true, true, true, false])
  expect(steps[0]).toMatchObject({ tools: ['read', 'exec'], t1: START + 3500, msgs: 0 })
  expect([steps[1]!.gapMs, steps[4]!.gapMs, steps[7]!.gapMs]).toEqual([119500, 285000, 2460000 - 975000])
  expect(steps[3]!.gapMs).toBe(55000)
})

test('the compactor\'s request is a compaction, the subagent\'s chain a start and a stop, and run_subagent its handoff', () => {
  const { events, compactions } = devinRecords(session())
  const sub = events.find(e => e.k === 'agent-start')!.thread
  expect(compactions).toEqual([{ thread: MAIN, model: 'compactor', usage: { in: 42000, cr: 0, cw: 0, out: 3000 } }])
  expect(events.map(e => [e.k, ('t' in e ? e.t : e.t0) - START])).toEqual([
    ['agent-call', 123000],
    ['agent-start', 124000],
    ['agent-stop', 183000],
    ['compact', 40 * MIN],
  ])
  expect(events[0]).toMatchObject({ thread: MAIN, agent: sub, agentType: 'Sidekick', status: 'started', bg: true })
})

test('a session put together: totals by role and type, the compaction under its own type, and the subagent\'s type', () => {
  const c = newCollector()
  applyDevin(c, devinRecords(session()))
  expect(Object.keys(c.groups).sort()).toEqual(['main|compaction|compactor', 'main||claude-fable-5-1-medium', 'subagent|Sidekick|swe-2-medium'])
  expect(c.groups['main||claude-fable-5-1-medium']!.steps).toBe(6)
  expect(Object.values(c.agentTypes)).toEqual(['Sidekick'])
})

test('a row with no request id, no time or no usage is left out, as are rows the query could not read', () => {
  node = 0
  const rows = [row(null, { role: 'user' }), row(1, { req: 'r', t0: 'not a time', t1: at(1), inp: 1, cr: 0, cw: 0, out: 1, model: 'swe-2-max' }), row(2, { req: 'r2', t0: at(2), t1: at(3), model: 'swe-2-max' })]
  expect(devinRecords(rows).steps).toEqual([])
})
