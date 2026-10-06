import { expect, test } from 'claude-code/testing'

import { LEAP_MS, leapClipMs, leapX, step } from './anim'
import type { Activity } from './anim'
import { HEIGHT, compose, encodeSvg } from './pixels'
import { DESKTOP_BAND_W, DRIFT_MS, GROUND_H, SCENE_SIZE, drawBand, layScene, obstacleSpans } from './scene'
import type { Scene } from './scene'
import { animate, maxSize, readTheme } from './theme'

const rock = ['.rr.', 'rrrr']
const bodyOf = (v: unknown) => {
  const read = readTheme(v)
  if (read.errors) {
    throw new Error(read.errors.join('\n'))
  }
  return animate(read.theme)
}
const scene: Scene = { ground: ['gg.'], obstacles: [rock, ['r', 'r', 'r']], decor: [['y'], ['yy', '..']], every: 40 }

test('a scene lays out the same way at the same width, with obstacles far enough apart to leap one after another', () => {
  const layout = layScene(scene, 300)
  expect(layScene(scene, 300)).toEqual(layout)
  const spans = obstacleSpans(layout)
  expect(spans[0]?.x).toBe(24)
  expect(spans.every(o => o.x + o.w <= 300)).toBe(true)
  for (let k = 1; k < spans.length; k++) {
    const [a, b] = [spans[k - 1], spans[k]] as [{ x: number; w: number }, { x: number; w: number }]
    expect(b.x - (a.x + a.w) >= 20 + 3).toBe(true)
  }
  const clearOf = (x: number, w: number) => spans.every(o => x + w < o.x - 1 || x > o.x + o.w)
  expect(layout.decor.length > 0 && layout.decor.every(d => clearOf(d.x, d.rows[0]?.length ?? 0))).toBe(true)
})

test('the band draws the ground across its width, obstacles on the ground, and the pet over them', () => {
  const body = bodyOf({ sprite: ['b'], palette: { b: '#222222', g: '#00ff00', r: '#ff0000', y: '#ffff00' } })
  const layout = { width: 10, obstacles: [{ x: 4, rows: rock }], decor: [] }
  const picture = { w: 2, h: HEIGHT, px: [...new Array(2 * (HEIGHT - 1)).fill(-1), 0x222222, 0x222222] }
  const band = drawBand(body, scene, layout, picture, 5, 0)
  const at = (x: number, y: number) => band.px[y * band.w + x]
  expect([band.w, band.h]).toEqual([10, HEIGHT + GROUND_H])
  expect([0, 1, 2, 3, 9].map(x => at(x, HEIGHT))).toEqual([0x00ff00, 0x00ff00, -1, 0x00ff00, 0x00ff00])
  expect([at(4, HEIGHT - 1), at(5, HEIGHT - 2), at(4, HEIGHT - 2)]).toEqual([0xff0000, 0xff0000, -1])
  expect([at(5, HEIGHT - 1), at(6, HEIGHT - 1)]).toEqual([0x222222, 0x222222])
})

test('raised decor drifts left and comes back in from the right; decor on the ground stays', () => {
  const body = bodyOf({ sprite: ['b'], palette: { b: '#222222', y: '#ffff00', g: '#00ff00' } })
  const layout = { width: 10, obstacles: [], decor: [{ x: 1, rows: ['yy', '..'], drift: 1000 }, { x: 6, rows: ['g'] }] }
  const picture = { w: 1, h: HEIGHT, px: new Array(HEIGHT).fill(-1) }
  const cloud = (ms: number) => {
    const band = drawBand(body, scene, layout, picture, 0, ms)
    return [...Array(10).keys()].filter(x => band.px[(HEIGHT - 2) * band.w + x] === 0xffff00)
  }
  const flower = (ms: number) => drawBand(body, scene, layout, picture, 0, ms).px[(HEIGHT - 1) * 10 + 6]
  expect([cloud(0), cloud(999), cloud(1000), cloud(2000)]).toEqual([[1, 2], [1, 2], [0, 1], [0, 9]])
  expect(cloud(10000)).toEqual([1, 2])
  expect([flower(0), flower(5000)]).toEqual([0x00ff00, 0x00ff00])
})

test('raised decor drifts, each drawing at its own speed; decor on the ground has no drift', () => {
  const layout = layScene({ obstacles: [], decor: [['yy', '..'], ['g']], every: 40 }, 300)
  const raised = layout.decor.filter(d => d.rows.length === 2)
  expect(raised.length > 1 && raised.every(d => d.drift !== undefined && d.drift >= DRIFT_MS.fast && d.drift <= DRIFT_MS.slow)).toBe(true)
  expect(new Set(raised.map(d => d.drift)).size > 1).toBe(true)
  expect(layout.decor.filter(d => d.rows.length === 1).every(d => d.drift === undefined)).toBe(true)
})

test('the sky drawing stays near the top right, behind drifting decor', () => {
  const body = bodyOf({ sprite: ['b'], palette: { b: '#222222', y: '#ffff00', o: '#ff8800' } })
  const sky = ['oo', 'oo']
  const layout = { width: 20, obstacles: [], decor: [{ x: 12, rows: ['y', ...Array(HEIGHT - 2).fill('.')], drift: 1000 }] }
  const picture = { w: 1, h: HEIGHT, px: new Array(HEIGHT).fill(-1) }
  const at = (ms: number, x: number, y: number) => {
    const band = drawBand(body, { ...scene, sky }, layout, picture, 0, ms)
    return band.px[y * band.w + x]
  }
  expect([at(0, 12, 1), at(0, 13, 2), at(9000, 12, 1)]).toEqual([0xffff00, 0xff8800, 0xff8800])
})

test('the largest pet clears the tallest, widest obstacle at every frame of a leap, both ways', () => {
  const max = maxSize(1)
  const body = bodyOf({ sprite: Array.from({ length: max.h }, () => 'b'.repeat(max.w)), palette: { b: '#888888' } })
  const o = { x: 60, w: SCENE_SIZE.obstacle.w }
  const top = HEIGHT - SCENE_SIZE.obstacle.h
  for (const dir of [1, -1] as const) {
    const w: Activity = { isWorking: true, activeTools: 0, activeMode: 'bash', activeTarget: '', lastToolAt: 1e9, room: 200, obstacles: [o], trail: 0 }
    let a = step({ mode: 'run', since: 0, x: dir === 1 ? 20 : 100, dir, tick: 0, target: '', working: true }, w, 0)
    for (let t = 100; !a.leap && t < 20000; t += 100) {
      a = step(a, w, t)
    }
    const leap = a.leap as NonNullable<typeof a.leap>
    for (let u = 0; u <= LEAP_MS; u += 5) {
      const picture = compose(body, 'jump', leapClipMs(u), dir)
      const x = Math.round(leapX(leap, u))
      for (let y = top; y < HEIGHT; y++) {
        for (let c = o.x; c < o.x + o.w; c++) {
          const inside = c - x >= 0 && c - x < picture.w
          expect(inside && picture.px[y * picture.w + c - x] !== -1).toBe(false)
        }
      }
    }
  }
})

test('the busiest scene at the widest desktop band stays under the Svg element\'s 131072 characters', () => {
  // A checkerboard in every drawing gives the most runs, so the most paths.
  const checker = (w: number, h: number) => Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => ((x + y) % 2 ? 'a' : 'b')).join(''))
  const busy: Scene = { ground: checker(16, GROUND_H), sky: checker(16, 12), obstacles: [checker(8, 6)], decor: [checker(16, HEIGHT)], every: 30 }
  const pet = bodyOf({ name: 'busy', sprite: checker(19, 20), palette: { a: '#123456', b: '#654321' } })
  const layout = layScene(busy, DESKTOP_BAND_W)
  const band = drawBand(pet, busy, layout, compose(pet, 'idle', 0, 1), 0, 0)

  expect(band.w).toBe(DESKTOP_BAND_W)
  expect(encodeSvg(band).length).toBeLessThan(131072)
})
