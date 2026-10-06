import { expect, test } from 'claude-code/testing'

import { EXPORT_KIND, anonymizeRecords, exportOf, exportText } from './exportFile'
import { MAIN } from './record'
import type { MeterRecord } from './record'
import type { SessionFile } from './sessionFile'

const START = Date.UTC(2026, 9, 5, 9, 0)
const step = (thread: string, turn: string, t0: number, tools: string[] = []) =>
  ({ k: 'step', t0: START + t0, t1: START + t0 + 500, turn, idx: 0, thread, model: 'claude-opus-5-5', in: 1, out: 2, cr: 300, cw: 40, ctx: 341, msgs: 3, tools }) as MeterRecord

const RECORDS: MeterRecord[] = [
  step(MAIN, 'turn-aaa', 0, ['Read', 'mcp__gmail__search_threads', 'Agent']),
  { k: 'agent-call', t0: START + 1000, t1: START + 9000, thread: MAIN, agent: 'agent-7f3a9c', agentType: 'Explore', status: 'completed' },
  { k: 'agent-start', t: START + 1500, thread: 'agent-7f3a9c', agentType: 'Explore' },
  step('agent-7f3a9c', 'turn-bbb', 2000),
  { k: 'ttl', t: START + 9000, thread: 'agent-7f3a9c', ttl: '5m', source: 'agent-call' },
  step(MAIN, 'turn-aaa', 10000),
  { k: 'send', t: START + 20000, thread: MAIN, to: 'agent-7f3a9c', risk: true, mode: 'warn' },
  step('agent-0d0d', 'turn-ccc', 30000),
  step(MAIN, 'turn-ddd', 40000),
]

test('agent ids become a1, a2 in the order first seen, the same in every field; main stays main', () => {
  const out = anonymizeRecords(RECORDS, START)
  expect(out.map(r => ('thread' in r ? r.thread : ''))).toEqual([MAIN, MAIN, 'a1', 'a1', 'a1', MAIN, MAIN, 'a2', MAIN])
  expect(out[1]).toMatchObject({ agent: 'a1' })
  expect(out[6]).toMatchObject({ to: 'a1' })
})

test('turn ids become t1, t2 by session, MCP tools become mcp, and times count from the session\'s start', () => {
  const out = anonymizeRecords(RECORDS, START)
  const steps = out.filter(r => r.k === 'step')
  expect(steps.map(s => s.turn)).toEqual(['t1', 't2', 't1', 't3', 't4'])
  expect(steps[0]).toMatchObject({ t0: 0, t1: 500, tools: ['Read', 'mcp', 'Agent'] })
  expect(out[1]).toMatchObject({ t0: 1000, t1: 9000 })
  expect(JSON.stringify(out)).not.toMatch(/agent-7f3a9c|agent-0d0d|turn-|gmail/)
})

const FILE = (sid: string, startedAt: number): SessionFile => ({
  v: 1, sid, project: 'a1b2c3d4e5f6', startedAt, savedAt: startedAt + 50000, version: '1.0.0', settings: { mainTtl: 'auto', subagentTtl: 'auto', coldTokens: 50000, outputWeight: 5 }, costUsd: 2.5,
  dropped: 0, groups: { 'main||claude-opus-5-5': { steps: 3, in: 3, out: 6, cr: 900, cw: 120 } }, names: { scout: 'agent-7f3a9c' }, timings: { 'turn.step': { count: 5, meanMs: 0.1, p95Ms: 0.2, maxMs: 0.4 } }, records: RECORDS,
})
const OPTS = { label: '', version: '1.0.0', day: '2026-10-06', days: 30, settings: { mainTtl: 'auto' as const, subagentTtl: 'auto' as const, coldTokens: 50000, outputWeight: 5 } }

test('an export holds the summary and each session by a hashed id, with no session id, name or agent id of its own', () => {
  const out = exportOf([{ file: FILE('2f6c1d0a-8e1b-4c55-9a39-0c0f6f9e6b11', START), id: '9f9f9f9f9f9f' }], OPTS)
  expect(out).toMatchObject({ kind: EXPORT_KIND, v: 1, label: 'anonymous', version: '1.0.0', day: '2026-10-06', days: 30 })
  expect(out.summary.sessions).toBe(1)
  expect(out.sessions[0]).toMatchObject({ id: '9f9f9f9f9f9f', project: 'a1b2c3d4e5f6', startedDay: '2026-10-05', costUsd: 2.5, dropped: 0, timings: { 'turn.step': { count: 5 } } })
  const text = JSON.stringify(out)
  expect(text).not.toMatch(/2f6c1d0a|scout|agent-7f3a9c/)
  expect(exportOf([], { ...OPTS, label: 'Nhon' }).label).toBe('Nhon')
})

test('an export over the size limit leaves out the records of its oldest sessions first, and keeps every total', () => {
  const out = exportOf([{ file: FILE('s-old-0000001', START), id: 'old' }, { file: FILE('s-new-0000001', START + 86400000), id: 'new' }], OPTS)
  const text = exportText(out, JSON.stringify(out).length - 10)
  const back = JSON.parse(text)
  expect(back.sessions.map((s: { id: string; records?: unknown[]; recordsLeftOut?: boolean }) => [s.id, s.records?.length ?? 0, s.recordsLeftOut === true])).toEqual([['old', 0, true], ['new', RECORDS.length, false]])
  expect(back.summary).toEqual(out.summary)
})
