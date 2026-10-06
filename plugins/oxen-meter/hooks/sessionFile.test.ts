import { expect, test } from 'claude-code/testing'

import { MAIN, addEvent, addStep, gapOf, newCollector, stepRecordOf } from './record'
import { TOMBSTONE, isExpired, readSessionText, restoreCollector, sessionText } from './sessionFile'
import { noteTiming } from './timing'

const DAY = 86400000
const USAGE = { input_tokens: 10, output_tokens: 400, cache_read_input_tokens: 90000, cache_creation_input_tokens: 3000, model: 'claude-opus-5-5' }
const STEP = { turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 4 }
const META = { sid: '2f6c1d0a-8e1b-4c55-9a39-0c0f6f9e6b11', project: 'a1b2c3d4e5f6', startedAt: 1000, savedAt: 9000, version: '0.1.0', settings: { mainTtl: 'auto', subagentTtl: 'auto', coldTokens: 50000, outputWeight: 5 } } as const

function collector(steps: number) {
  const c = newCollector()
  addEvent(c, { k: 'agent-start', t: 0, thread: 'a1', agentType: 'Explore' })
  for (let i = 0; i < steps; i++) {
    addStep(c, stepRecordOf({ ...STEP, index: i, ...(i % 2 ? { agentId: 'a1' } : {}) }, { toolUses: [], stopReason: 'end_turn', usage: USAGE }, i * 1000, i * 1000 + 500, c))
  }
  c.names.scout = 'a1'
  noteTiming(c.timings, 'turn.step', 0.2)
  return c
}

test('a session file reads back as written: its meta, records, totals, names and hook times', () => {
  const c = collector(4)
  const file = readSessionText(sessionText(c, META))!
  expect(file).toMatchObject({ v: 1, ...META, dropped: 0, groups: c.groups, names: { scout: 'a1' } })
  expect(file.records).toEqual(c.records)
  expect(file.timings['turn.step']).toEqual({ count: 1, meanMs: 0.2, p95Ms: 0.2, maxMs: 0.2 })
})

test('a restored collector goes on where the file left off: threads, agent types, names', () => {
  const c = collector(4)
  const restored = restoreCollector(readSessionText(sessionText(c, META))!)
  expect(restored.threads).toEqual(c.threads)
  expect(restored.agentTypes).toEqual({ a1: 'Explore' })
  expect(restored.names).toEqual({ scout: 'a1' })
  expect(gapOf(restored, MAIN, 10000)).toBe(8000)
  expect(restored.dirty).toBe(false)
})

test('a file over the size limit drops its oldest steps until it fits, and keeps the exact totals', () => {
  const c = collector(40)
  const full = sessionText(c, META)
  const text = sessionText(c, META, 4000)
  expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(4000)
  const file = readSessionText(text)!
  expect(file.dropped).toBeGreaterThan(0)
  expect(file.records[0]).toEqual({ k: 'agent-start', t: 0, thread: 'a1', agentType: 'Explore' })
  expect(file.records.length + file.dropped).toBe(41)
  expect(file.groups).toEqual(c.groups)
  expect(c.records.length).toBe(41)
  expect(full.length).toBeGreaterThan(4000)
})

test('an emptied file, a file that is not JSON, or one of another shape reads as nothing', () => {
  for (const text of [TOMBSTONE, '', '{', 'null', '[]', '{"v":2,"sid":"x","records":[],"groups":{}}', '{"v":1,"records":[],"groups":{}}', '{"v":1,"sid":"s","records":{},"groups":{}}']) {
    expect(readSessionText(text)).toBeUndefined()
  }
})

test('a record of a kind this version does not know is left out, so a newer file still reads', () => {
  const text = sessionText(collector(1), META).replace('"records":[', '"records":[{"k":"from-the-future","t":1},')
  expect(readSessionText(text)!.records.map(r => r.k)).toEqual(['agent-start', 'step'])
})

test('a file expires once it is older than the retention days', () => {
  expect(isExpired(0, 30 * DAY, 30)).toBe(false)
  expect(isExpired(0, 30 * DAY + 1, 30)).toBe(true)
})

test('a session file keeps the tool that wrote it; a file of 1.0.0 has none, and a tool it does not know is dropped', () => {
  const c = collector(2)
  expect(readSessionText(sessionText(c, { ...META, tool: 'codex' }))!.tool).toBe('codex')
  expect(readSessionText(sessionText(c, META))!.tool).toBeUndefined()
  const odd = JSON.parse(sessionText(c, META))
  expect(readSessionText(JSON.stringify({ ...odd, tool: 'vim' }))!.tool).toBeUndefined()
})

test('a quota record reads back; a keepalive step keeps its mark', () => {
  const c = collector(1)
  addEvent(c, { k: 'quota', t: 5, thread: MAIN, windowMin: 10080, used: 12.5 })
  addStep(c, { ...(c.records.find(r => r.k === 'step') as Extract<(typeof c.records)[number], { k: 'step' }>), t0: 9000, keepalive: true })
  const file = readSessionText(sessionText(c, META))!
  expect(file.records.filter(r => r.k === 'quota')).toEqual([{ k: 'quota', t: 5, thread: MAIN, windowMin: 10080, used: 12.5 }])
  expect(file.records.filter(r => r.k === 'step' && r.keepalive).length).toBe(1)
})
