import { expect, test } from 'claude-code/testing'

import { EYE_COLOR, MAX_MINIS, MODES, compose, crop, encodeCells, expressionName, frameIndex } from './pixels'
import type { Body, Canvas } from './pixels'

// A stub pet: a solid block with the eye boxes where the slime's first stand frame has them.
const frame = { g: Array.from({ length: 20 }, (_, y) => (y >= 12 ? '..dddddddddddddd...' : '...................')), l: [5, 13], r: [10, 13], e: 'open' } as Body['clips']['stand']['frames'][number]
const clip = { fps: 8, frames: [frame, frame] }
const body: Body = {
  name: 'block',
  w: 19,
  h: 20,
  palette: { d: 0x3d84f0 },
  eye: EYE_COLOR,
  mini: { top: 0x9ad2ff, body: 0x3d84f0, edge: 0x1e3a8a },
  props: {},
  look: { lines: {}, lineColors: {}, hud: {} },
  clips: { stand: clip, run: clip, jump: clip, think: clip, cheer: clip },
}

test('a loop clip wraps and a one-shot clip holds its last frame', () => {
  expect(frameIndex(8, 12, 0, true)).toBe(0)
  expect(frameIndex(8, 12, 1000 / 12, true)).toBe(1)
  expect(frameIndex(8, 12, 8000 / 12, true)).toBe(0)
  expect(frameIndex(14, 12, 60000, false)).toBe(13)
})

test('two pixels become one half-block cell, a clear one the terminal default', () => {
  expect(encodeCells({ w: 1, h: 2, px: [0xff0000, -1] })).toBe('gCUAAAAA/wAAAAAB')
  expect(encodeCells({ w: 1, h: 2, px: [-1, -1] })).toBe('IAAAAAAAAAEAAAAB')
})

test('an eye sequence loops by its own lengths', () => {
  expect(expressionName('idle', 0, '')).toBe('open')
  expect(expressionName('idle', 2500, '')).toBe('blink')
  expect(expressionName('edit', 3100, '')).toBe('blink')
  expect(expressionName('run', 0, 'bar')).toBe('blink')
  expect(expressionName('idle', 0, '', 'critical')).toBe('dizzy')
  expect(expressionName('edit', 0, '', 'critical')).toBe('focus')
})

test('every mode draws a canvas of its size, with a prop only where the mode has one', () => {
  for (const mode of Object.keys(MODES) as (keyof typeof MODES)[]) {
    for (const t of [0, 500, 1300, 2900]) {
      const c = compose(body, mode, t, 1)
      expect(c.h).toBe(20)
      expect(c.w).toBe(MODES[mode].prop ? 33 : 19)
      expect(c.px.length).toBe(c.w * c.h)
    }
  }
})

const mirrored = (c: Canvas) => Array.from({ length: c.h }, (_, y) => c.px.slice(y * c.w, (y + 1) * c.w).reverse()).flat()

test('a running pet facing left is the mirror of one facing right', () => {
  expect(compose(body, 'run', 100, -1).px).toEqual(mirrored(compose(body, 'run', 100, 1)))
})

test('each mini widens the picture by its trail, up to MAX_MINIS', () => {
  const mini = { age: 1000 }
  expect(compose(body, 'idle', 0, 1, 'ok', [mini]).w).toBe(19 + 6)
  expect(compose(body, 'read', 0, 1, 'ok', [mini, mini]).w).toBe(33 + 12)
  expect(compose(body, 'idle', 0, 1, 'ok', Array.from({ length: MAX_MINIS + 3 }, () => mini)).w).toBe(19 + MAX_MINIS * 6)
})

test('the trail stays behind the pet: left when running right, right when running left', () => {
  const minis = [{ age: 1000 }]
  const right = compose(body, 'run', 100, 1, 'ok', minis)
  const left = compose(body, 'run', 100, -1, 'ok', minis)
  const filled = (c: typeof right, x0: number, x1: number) => {
    for (let y = 0; y < c.h; y++) {
      for (let x = x0; x < x1; x++) {
        if ((c.px[y * c.w + x] as number) !== -1) {
          return true
        }
      }
    }
    return false
  }
  expect(filled(right, 0, 6)).toBe(true)
  expect(filled(left, left.w - 6, left.w)).toBe(true)
})

test('a time before the mode began draws its first frame', () => {
  for (const mode of Object.keys(MODES) as (keyof typeof MODES)[]) {
    expect(compose(body, mode, -250, 1).px).toEqual(compose(body, mode, 0, 1).px)
  }
})

test("a pet's own prop replaces the mod's, plays its frames, and null leaves the mode without one", () => {
  const own: Body = { ...body, props: { read: [['dd'], ['..', 'dd']], bash: null, think: [['d']] } }
  const first = compose(own, 'read', 0, 1)
  const second = compose(own, 'read', 250, 1)
  expect(first.w).toBe(33)
  expect(first.px[19 * 33 + 17]).toBe(0x3d84f0)
  expect(first.px[18 * 33 + 17]).toBe(-1)
  expect(second.px[18 * 33 + 17]).toBe(-1)
  expect(second.px[19 * 33 + 17]).toBe(0x3d84f0)
  expect(compose(own, 'bash', 0, 1).w).toBe(19)
  expect(compose(own, 'think', 0, 1).w).toBe(33)
  expect(compose(body, 'think', 0, 1).px).toContain(0xffe25a)
  expect(compose(own, 'think', 0, 1).px).not.toContain(0xffe25a)
})

test("a pet's own mini draws in its palette, and grey once its subagent fails", () => {
  const own: Body = { ...body, palette: { d: 0x3d84f0, g: 0x44cc44 }, miniSprite: ['ggggg'] }
  const running = compose(own, 'idle', 0, 1, 'ok', [{ age: 5000 }])
  const failed = compose(own, 'idle', 0, 1, 'ok', [{ age: 5000, doneFor: 100, failed: true }])
  expect(running.px.filter(c => c === 0x44cc44)).toHaveLength(5)
  expect(failed.px.filter(c => c === 0x44cc44)).toHaveLength(0)
  expect(failed.px.filter(c => c !== -1 && ((c >> 16) & 255) === (c & 255) && (c & 255) === ((c >> 8) & 255)).length).toBeGreaterThanOrEqual(5)
})

test('crop takes a part of a canvas', () => {
  const c = { w: 3, h: 2, px: [1, 2, 3, 4, 5, 6] }
  expect(crop(c, 1, 0, 2, 2)).toEqual({ w: 2, h: 2, px: [2, 3, 5, 6] })
})

test('a jump to the left mirrors the picture, as a run does', () => {
  expect(compose(body, 'jump', 100, -1).px).toEqual(mirrored(compose(body, 'jump', 100, 1)))
})
