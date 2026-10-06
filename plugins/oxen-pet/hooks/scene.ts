import { HEIGHT, canvas, hash, overlay, stamp } from './pixels'
import type { Body, Canvas } from './pixels'

/**
 * A theme's scene, in the pet's palette: a ground tile, a sky drawing that stays put, the obstacles a running pet
 * leaps, and decor behind it.
 */
export type Scene = { ground?: string[]; sky?: string[]; obstacles: string[][]; decor: string[][]; every: number }
/** The columns one obstacle fills on the band: `w` of them from `x`. */
export type Span = { x: number; w: number }
/** A drawing at column `x`; `drift`, when set, is the milliseconds it takes to drift one column left. */
type Placed = { x: number; rows: string[]; drift?: number }
/** Where a scene's obstacles and decor sit on a band `width` columns wide. */
export type SceneLayout = { width: number; obstacles: Placed[]; decor: Placed[] }

export const GROUND_H = 2 // pixels: one row of cells below the pet
/** The widest the desktop draws a band with a scene, in pixels, which keeps its SVG well under the Svg element's 131072 characters. */
export const DESKTOP_BAND_W = 160
/** The largest ground tile, obstacle, and decor, in pixels, and how many obstacles and decor a scene keeps. */
export const SCENE_SIZE = { ground: { w: 16, h: GROUND_H }, sky: { w: 16, h: 12 }, obstacle: { w: 8, h: 6 }, decor: { w: 16, h: HEIGHT }, items: 4 }
/** The least and most columns between obstacles; the least leaves room to land a leap and take off for the next. */
export const EVERY = { min: 30, max: 120, normal: 40 }
const FIRST_OBSTACLE = 24 // columns left clear, so a pet that starts at the left edge stands clear of them
const DECOR_EVERY = 12
/** The fastest and slowest a raised decor drawing drifts: milliseconds per column. */
export const DRIFT_MS = { fast: 1100, slow: 1900 }
const SKY_AT = { right: 6, top: 1 } // columns from the band's right edge, pixels from its top

const widthOf = (rows: string[]) => Math.max(...rows.map(r => r.length))
const isRaised = (rows: string[]) => /^\.*$/.test(rows[rows.length - 1] ?? '')

/** Lays out `scene` on a band `width` columns wide. The same scene and width always lay out the same way. */
export function layScene(scene: Scene, width: number): SceneLayout {
  const obstacles: Placed[] = []
  for (let x = FIRST_OBSTACLE, k = 0; scene.obstacles.length > 0; k++) {
    const rows = scene.obstacles[k % scene.obstacles.length] as string[]
    if (x + widthOf(rows) > width) {
      break
    }
    obstacles.push({ x, rows })
    x += widthOf(rows) + scene.every + Math.round(((hash(k) - 0.5) * scene.every) / 3)
  }
  const isClear = (x: number, w: number) => obstacles.every(o => x + w < o.x - 1 || x > o.x + widthOf(o.rows))
  const decor: Placed[] = []
  for (let x = 2, k = 0; scene.decor.length > 0; k++) {
    const rows = scene.decor[Math.floor(hash(k + 101) * scene.decor.length)] as string[]
    const w = widthOf(rows)
    if (x + w > width) {
      break
    }
    if (isClear(x, w)) {
      decor.push(isRaised(rows) ? { x, rows, drift: Math.round(DRIFT_MS.fast + hash(k + 503) * (DRIFT_MS.slow - DRIFT_MS.fast)) } : { x, rows })
    }
    x += w + DECOR_EVERY + Math.round(hash(k + 307) * DECOR_EVERY)
  }

  return { width, obstacles, decor }
}

export const obstacleSpans = (layout: SceneLayout): Span[] => layout.obstacles.map(o => ({ x: o.x, w: widthOf(o.rows) }))

/**
 * The band with a scene at `ms`: the sky drawing near the top right, decor, then obstacles standing on the ground, then
 * `picture` (the pet as `compose` drew it) from column `left`. Decor with a `drift` moves left and comes back in from
 * the right edge. The canvas is `layout.width` wide; its bottom GROUND_H rows hold the ground.
 */
export function drawBand(body: Body, scene: Scene, layout: SceneLayout, picture: Canvas, left: number, ms: number): Canvas {
  const c = canvas(layout.width, HEIGHT + GROUND_H)
  if (scene.sky) {
    stamp(c, layout.width - widthOf(scene.sky) - SKY_AT.right, SKY_AT.top, scene.sky, body.palette)
  }
  for (const d of layout.decor) {
    const y = HEIGHT - d.rows.length
    if (d.drift === undefined) {
      stamp(c, d.x, y, d.rows, body.palette)
      continue
    }
    const x = (((d.x - Math.floor(ms / d.drift)) % layout.width) + layout.width) % layout.width
    stamp(c, x, y, d.rows, body.palette)
    stamp(c, x - layout.width, y, d.rows, body.palette) // the part past the right edge, back in at the left
  }
  for (const o of layout.obstacles) {
    stamp(c, o.x, HEIGHT - o.rows.length, o.rows, body.palette)
  }
  if (scene.ground) {
    for (let x = 0; x < layout.width; x += widthOf(scene.ground)) {
      stamp(c, x, HEIGHT, scene.ground, body.palette)
    }
  }
  overlay(c, picture, left)

  return c
}
