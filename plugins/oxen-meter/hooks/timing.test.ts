import { expect, test } from 'claude-code/testing'

import { RING, newTimings, noteTiming, timingRows, timingSummary } from './timing'

test('a hook with no calls has no summary', () => {
  const t = newTimings()
  expect(t['turn.step']).toBeUndefined()
  expect(timingRows(t)).toEqual([])
})

test('the summary counts calls, and gives the mean, the 95th percentile and the slowest', () => {
  const t = newTimings()
  for (let i = 1; i <= 100; i++) {
    noteTiming(t, 'turn.step', i / 100)
  }
  expect(timingSummary(t['turn.step']!)).toEqual({ count: 100, meanMs: 0.505, p95Ms: 0.95, maxMs: 1 })
})

test('the percentile reads the last RING calls only, while the count, mean and max keep every call', () => {
  const t = newTimings()
  noteTiming(t, 'tool.call', 50)
  for (let i = 0; i < RING; i++) {
    noteTiming(t, 'tool.call', 0.1)
  }
  const s = timingSummary(t['tool.call']!)
  expect(s.count).toBe(RING + 1)
  expect(s.maxMs).toBe(50)
  expect(s.p95Ms).toBe(0.1)
  expect(t['tool.call']!.ring.length).toBe(RING)
})

test('a negative or non-finite duration counts as zero', () => {
  const t = newTimings()
  noteTiming(t, 'x', -3)
  noteTiming(t, 'x', Number.NaN)
  expect(timingSummary(t.x!)).toEqual({ count: 2, meanMs: 0, p95Ms: 0, maxMs: 0 })
})

test('the rows name each hook, slowest mean first, in milliseconds', () => {
  const t = newTimings()
  noteTiming(t, 'turn.step', 0.04)
  noteTiming(t, 'tool.call', 0.2)
  expect(timingRows(t)).toEqual([
    { hook: 'tool.call', text: '0.20 ms mean · p95 0.20 · max 0.20 · 1 call' },
    { hook: 'turn.step', text: '0.04 ms mean · p95 0.04 · max 0.04 · 1 call' },
  ])
})
