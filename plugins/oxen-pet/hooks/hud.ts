import type { SessionUsage } from 'claude-code'

import { encodeCells } from './pixels'
import type { Canvas } from './pixels'

export const BAR_W = 20 // cells; a bar is one cell row, two pixels tall

// The window frame around the HUD. Blue, not white, so it shows on a light terminal too.
export const FRAME_COLOR = '#5aa9ff'

export type Hud = {
  hp: number // context left, %
  mp?: number // the 5-hour rate limit left, %; absent off a subscription or before its first reading
  mpResetsInMin?: number
  st?: number // the 7-day rate limit left, %; absent like MP
  stResetsInMin?: number
}

export type Mood = 'ok' | 'worried' | 'critical' | 'tired'

/** A pet's look for one bar: its label, the label's color, and the fill while the bar is healthy. */
export type BarLook = { label?: string; color?: string; fill?: [string, string] }
/** A pet's look for the HUD: the frame's color, and each bar's look, or false to hide it. */
export type HudLook = { frame?: string; hp?: BarLook | false; mp?: BarLook | false; st?: BarLook | false }

/** The frame's color: the pet's own, else the mod's. */
export const frameColor = (look: HudLook) => look.frame ?? FRAME_COLOR

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const finite = (v: number | undefined) => (v !== undefined && Number.isFinite(v) ? v : undefined)

/** One rate-limit window: the share left, and the minutes until it resets. Both absent without a reading. */
function limitLeft(u: SessionUsage, kind: string, now: number) {
  const limit = u.rateLimits.find(r => r.kind === kind && finite(r.percentUsed) !== undefined)
  const resets = limit?.resetsAt ? Date.parse(limit.resetsAt) : Number.NaN

  return {
    left: limit ? clamp(Math.round(100 - limit.percentUsed), 0, 100) : undefined,
    resetsInMin: !limit || Number.isNaN(resets) ? undefined : Math.max(0, Math.round((resets - now) / 60000)),
  }
}

export function hudFrom(u: SessionUsage, now: number): Hud {
  const mp = limitLeft(u, 'five_hour', now)
  const st = limitLeft(u, 'seven_day', now)

  return {
    hp: clamp(Math.round(100 - (finite(u.context.percent) ?? 0)), 0, 100),
    mp: mp.left,
    mpResetsInMin: mp.resetsInMin,
    st: st.left,
    stResetsInMin: st.resetsInMin,
  }
}

export function mood(h: Hud): Mood {
  if (h.hp <= 25) {
    return 'critical'
  }
  if (h.hp <= 50) {
    return 'worried'
  }

  return [h.mp, h.st].some(left => left !== undefined && left < 20) ? 'tired' : 'ok'
}

/** Minutes as the HUD prints them: `36m`, `2h13m`, then whole hours past a day, `3d4h`. */
export function fmtMin(m: number) {
  if (m >= 1440) {
    return `${Math.floor(m / 1440)}d${Math.floor((m % 1440) / 60)}h`
  }

  return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m` : `${m}m`
}

type Pair = [number, number]
const GREEN: Pair = [0x166534, 0x4ade80]
const YELLOW: Pair = [0xa16207, 0xfacc15]
const RED: Pair = [0x991b1b, 0xf87171]
const BLUE: Pair = [0x3b5bdb, 0xa78bfa]
const GOLD: Pair = [0xb45309, 0xfbbf24]

const channel = (c: number, shift: number) => (c >> shift) & 255
const mix = (a: number, b: number, t: number) =>
  [16, 8, 0].reduce((out, s) => out | (Math.round(channel(a, s) + (channel(b, s) - channel(a, s)) * t) << s), 0)
const darker = (c: number) => [16, 8, 0].reduce((out, s) => out | (Math.round(channel(c, s) * 0.6) << s), 0)

/** A bevelled bar: grey end caps, a gradient fill with a darker lower half. */
export function barCanvas(pct: number, [from, to]: Pair): Canvas {
  const px = new Array<number>(BAR_W * 2).fill(0x1b1e26)
  const fill = Math.round((clamp(pct, 0, 100) / 100) * (BAR_W - 2))
  for (let i = 0; i < fill; i++) {
    const c = mix(from, to, i / (BAR_W - 3))
    px[1 + i] = c
    px[BAR_W + 1 + i] = darker(c)
  }
  for (const x of [0, BAR_W - 1]) {
    px[x] = 0x6f7787
    px[BAR_W + x] = 0x6f7787
  }

  return { w: BAR_W, h: 2, px }
}

/** One run of a row's text. The reading is bold in its bar's color; the details beside it are grey. */
export type HudPart = { text: string; color: string; bold?: boolean }

export type HudRow = { key: string; label: string; color: string; cells: string; parts: HudPart[] }

// A mid grey, so the details read on a dark terminal and on a light one.
export const DETAIL_COLOR = '#8b93b8'

const cssColor = (c: number) => `#${c.toString(16).padStart(6, '0')}`
const reading = (text: string, [, bright]: Pair): HudPart => ({ text: ` ${text}`, color: cssColor(bright), bold: true })
const detail = (bits: (string | undefined)[]): HudPart[] => {
  const text = bits.filter(b => b !== undefined).join('  ')

  return text ? [{ text: `  ${text}`, color: DETAIL_COLOR }] : []
}

const resets = (min: number | undefined) => (min === undefined ? undefined : `reset in ${fmtMin(min)}`)

const pairOf = (fill: [string, string] | undefined, fallback: Pair): Pair => (fill ? [parseInt(fill[0].slice(1), 16), parseInt(fill[1].slice(1), 16)] : fallback)

/**
 * The HUD's rows: HP, and MP and ST when the session has their readings, each in the pet's `look` unless
 * the look hides it. A bar's warning colors (yellow and red) replace its fill whatever the look.
 */
export function hudRows(h: Hud, look: HudLook = {}): HudRow[] {
  const rows: (HudRow & { look: BarLook | false | undefined })[] = []
  const hpFill = h.hp > 50 ? pairOf(look.hp ? look.hp.fill : undefined, GREEN) : h.hp > 25 ? YELLOW : RED
  rows.push({
    key: 'hp',
    look: look.hp,
    label: h.hp < 10 ? '⚠ HP' : '♥ HP',
    color: '#f87171',
    cells: encodeCells(barCanvas(h.hp, hpFill)),
    parts: [reading(`${h.hp}%`, hpFill), ...(h.hp < 10 ? [{ ...reading('/compact', RED), text: '  /compact' }] : [])],
  })
  if (h.mp !== undefined) {
    const mpFill = h.mp < 15 ? RED : pairOf(look.mp ? look.mp.fill : undefined, BLUE)
    rows.push({
      key: 'mp',
      look: look.mp,
      label: '✦ MP',
      color: '#7aa7ff',
      cells: encodeCells(barCanvas(h.mp, mpFill)),
      parts: [reading(`${h.mp}%`, mpFill), ...detail([resets(h.mpResetsInMin)])],
    })
  }
  if (h.st !== undefined) {
    const stFill = h.st < 15 ? RED : pairOf(look.st ? look.st.fill : undefined, GOLD)
    rows.push({
      key: 'st',
      look: look.st,
      label: '◆ ST',
      color: '#fbbf24',
      cells: encodeCells(barCanvas(h.st, stFill)),
      parts: [reading(`${h.st}%`, stFill), ...detail([resets(h.stResetsInMin)])],
    })
  }
  const shown = rows
    .filter(r => r.look !== false)
    .map(({ look: bar, ...r }) => (bar ? { ...r, label: bar.label ?? r.label, color: bar.color ?? r.color } : r))
  // Labels pad to one width, so the bars line up.
  const width = Math.max(0, ...shown.map(r => [...r.label].length))

  return shown.map(r => ({ ...r, label: r.label + ' '.repeat(width - [...r.label].length) }))
}

/**
 * The window's edges as text, `width` cells across, side cells included. A full block is one pixel wide
 * and a half block one pixel tall, so the lines are as thick as the pet's pixels. The corner cells stay
 * empty, which notches each corner by one pixel.
 */
export function windowEdges(width: number) {
  const run = Math.max(0, width - 2)

  return { top: ` ${'▄'.repeat(run)} `, side: '█', bottom: ` ${'▀'.repeat(run)} ` }
}

/** The HUD window's width in cells, sides included: room for a label, a bar and the longest row's text. */
export const HUD_WINDOW_W = 54
