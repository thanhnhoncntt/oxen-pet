import { expect, test } from 'claude-code/testing'

import type { Anim } from '../types'
import { LEAP_MS, fail, step } from './anim'
import type { Activity } from './anim'

const resting: Anim = { mode: 'idle', since: 0, x: 0, dir: 1, tick: 0, target: '', working: false }
const quiet: Activity = { isWorking: false, activeTools: 0, activeMode: 'bash', activeTarget: '', lastToolAt: 0, room: 40, obstacles: [], trail: 0 }

test('a turn starts with a jump, and a tool call cuts the jump short after 400 ms', () => {
  const jumping = step(resting, { ...quiet, isWorking: true }, 1000)
  expect([jumping.mode, jumping.since, jumping.working]).toEqual(['jump', 1000, true])
  const tool = { ...quiet, isWorking: true, activeTools: 1, activeMode: 'read' as const, activeTarget: 'app.ts', lastToolAt: 1100 }
  expect(step(jumping, tool, 1300).mode).toBe('jump')
  const reading = step(jumping, tool, 1400)
  expect([reading.mode, reading.target]).toEqual(['read', 'app.ts'])
})

test('between tool calls the pet runs, then thinks after 4 s, and keeps the last target', () => {
  const reading: Anim = { ...resting, mode: 'read', since: 0, working: true, target: 'app.ts' }
  const between = { ...quiet, isWorking: true, lastToolAt: 1000 }
  const running = step(reading, between, 1100)
  expect([running.mode, running.target]).toEqual(['run', 'app.ts'])
  expect(step(running, between, 5000).mode).toBe('think')
})

test('a running pet turns at the room it has and at the left edge', () => {
  const near: Anim = { ...resting, mode: 'run', working: true, x: 39.5, dir: 1 }
  const turned = step(near, { ...quiet, isWorking: true, lastToolAt: 0, room: 40, obstacles: [], trail: 0 }, 100)
  expect([turned.x, turned.dir]).toEqual([40, -1])
  const left = step({ ...near, x: 0.5, dir: -1 }, { ...quiet, isWorking: true }, 100)
  expect([left.x, left.dir]).toEqual([0, 1])
})

test('a turn ends with a cheer, then idles, and sleeps after a minute', () => {
  const cheering = step({ ...resting, mode: 'think', working: true }, quiet, 10000)
  expect([cheering.mode, cheering.since]).toEqual(['cheer', 10000])
  const idle = step(cheering, quiet, 11800)
  expect([idle.mode, idle.since]).toEqual(['idle', 11800])
  expect(step(idle, quiet, 71799).mode).toBe('idle')
  expect(step(idle, quiet, 71800).mode).toBe('sleep')
})

test('a failed call shows the error face, except over a cheer', () => {
  expect(fail({ ...resting, mode: 'bash' }, 500)).toEqual({ ...resting, mode: 'error', since: 500 })
  const cheering: Anim = { ...resting, mode: 'cheer', since: 100 }
  expect(fail(cheering, 500)).toBe(cheering)
})

test('a faster pace ends the fixed-length modes sooner and runs farther', () => {
  const fast = { pace: 1.6, sleepAfterMs: 60000 }
  const cheering: Anim = { ...resting, mode: 'cheer', since: 0 }
  expect(step(cheering, quiet, 1125, fast).mode).toBe('idle')
  expect(step(cheering, quiet, 1125).mode).toBe('cheer')
  const running: Anim = { ...resting, mode: 'run', working: true, x: 10 }
  expect(Math.round(step(running, { ...quiet, isWorking: true }, 100, fast).x * 100) / 100).toBe(11.44)
})

test('sleepAfterMs sets when the pet sleeps, and 0 keeps it awake', () => {
  expect(step(resting, quiet, 30000, { pace: 1, sleepAfterMs: 30000 }).mode).toBe('sleep')
  expect(step(resting, quiet, 10_000_000, { pace: 1, sleepAfterMs: 0 }).mode).toBe('idle')
  expect(step({ ...resting, mode: 'sleep' }, quiet, 100, { pace: 1, sleepAfterMs: 0 }).mode).toBe('idle')
})

test('state saved by another version starts over idle instead of failing', () => {
  const old = { mode: 'dance', since: 0, x: 3, dir: 1, tick: 7, target: '' } as unknown as Anim
  const next = step(old, quiet, 500)
  expect([next.mode, next.since, next.working]).toEqual(['idle', 500, false])
})

test('a running pet leaps an obstacle just ahead and lands one column past it', () => {
  const between = { ...quiet, isWorking: true, lastToolAt: 1e9, room: 100, obstacles: [{ x: 40, w: 4 }] }
  const near: Anim = { ...resting, mode: 'run', working: true, x: 20 }
  const off = step(near, between, 100)
  expect([off.mode, off.x, off.leap]).toEqual(['run', 20, { since: 100, from: 20, to: 45 }])
  const mid = step(off, between, 100 + LEAP_MS / 2)
  expect(mid.x > 20 && mid.x < 45).toBe(true)
  // It lands at 45 and runs on in the same tick.
  const landed = step(mid, between, 100 + LEAP_MS)
  expect([Math.floor(landed.x), landed.leap]).toEqual([45, undefined])
})

test('the leap measures from the body, past the trail of minis behind it', () => {
  const between = { ...quiet, isWorking: true, lastToolAt: 1e9, room: 100, obstacles: [{ x: 40, w: 4 }], trail: 12 }
  expect(step({ ...resting, mode: 'run', working: true, x: 20 }, between, 100).leap).toBe(undefined)
  expect(step({ ...resting, mode: 'run', working: true, x: 8 }, between, 100).leap).toEqual({ since: 100, from: 8, to: 33 })
  const left = step({ ...resting, mode: 'run', working: true, x: 46, dir: -1 }, between, 100)
  expect(left.leap).toEqual({ since: 100, from: 46, to: 20 })
})

test('a pet turns at an obstacle it cannot land past', () => {
  const between = { ...quiet, isWorking: true, lastToolAt: 1e9, room: 30, obstacles: [{ x: 40, w: 4 }] }
  const turned = step({ ...resting, mode: 'run', working: true, x: 20 }, between, 100)
  expect([turned.dir, turned.leap]).toEqual([-1, undefined])
})

test('a turn that ends mid-leap cheers once the pet lands', () => {
  const leaping: Anim = { ...resting, mode: 'run', working: true, x: 20, leap: { since: 0, from: 20, to: 45 } }
  const mid = step(leaping, quiet, LEAP_MS / 2)
  expect([mid.mode, mid.working]).toEqual(['run', true])
  const landed = step(mid, quiet, LEAP_MS)
  expect([landed.mode, landed.x]).toEqual(['cheer', 45])
})

test('the shield goes up at once while a risky command waits for the user, and comes down to what the session is doing', () => {
  const jumping = step(resting, { ...quiet, isWorking: true }, 1000)
  const guarding = step(jumping, { ...quiet, isWorking: true, guarding: true }, 1100)
  expect([guarding.mode, guarding.since]).toEqual(['guard', 1100])
  expect(step(guarding, { ...quiet, isWorking: true, guarding: true }, 60000).mode).toBe('guard')
  const after = step(guarding, { ...quiet, isWorking: true, lastToolAt: 60000 }, 60100)
  expect(after.mode).toBe('run')
})
