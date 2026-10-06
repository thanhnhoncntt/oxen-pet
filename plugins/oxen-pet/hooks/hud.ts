import type { SessionUsage } from 'claude-code'

import { encodeCells } from './pixels'
import type { Canvas } from './pixels'

export const BAR_W = 20 // cells; a bar is one cell row, two pixels tall
export const ROW_BAR_W = 10 // a bar's cells when the HUD lays its bars in a row

// The window frame around the HUD. Blue, not white, so it shows on a light terminal too.
export const FRAME_COLOR = '#5aa9ff'

export type Hud = {
  hp: number // context left, %
  mp?: number // the 5-hour rate limit left, %; absent off a subscription or before its first reading
  mpResetsInMin?: number
  st?: number // the 7-day rate limit left, %; absent like MP
  stResetsInMin?: number
  cacheMin?: number // minutes the prompt cache stays warm, 0 once cold; absent before the first turn or with the timer off
}

// Each rate-limit window's length in minutes, which the pace runs through.
export const MP_WINDOW_MIN = 300
export const ST_WINDOW_MIN = 10080
// How long a window runs before its burn rate is steady enough to forecast from.
const FORECAST_AFTER_MIN = 15

export type Mood = 'ok' | 'worried' | 'critical' | 'tired'

/** HP under this warns: `⚠ HP`, `/compact` beside the reading, and the low-context alert. */
export const LOW_HP = 20
const REARM_HP = 30 // HP must climb back to this, by a /compact or a new session, before the alert can fire again

/** Whether the low-context alert fires at `hp`, and whether it is armed after: it fires once per drop under LOW_HP. */
export function contextAlert(armed: boolean, hp: number) {
  if (armed && hp < LOW_HP) {
    return { alert: true, armed: false }
  }

  return { alert: false, armed: armed || hp >= REARM_HP }
}

/** The toast the low-context alert shows. */
export const contextAlertText = (hp: number) => `oxen-pet: ${hp}% of the context left. Run /compact now, or hand off to a fresh session.`

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

/** How many points a limit's share left is ahead of an even pace through its window; negative when behind. */
export function spareOf(left: number, resetsInMin: number, windowMin: number) {
  const evenLeft = (clamp(resetsInMin, 0, windowMin) / windowMin) * 100

  return Math.round(left - evenLeft)
}

/**
 * Minutes until a limit runs out at its average burn so far in the window, when that comes before its reset.
 * Absent when it lasts to the reset, or in the window's first minutes, when the rate is still noise.
 */
export function emptyInMin(left: number, resetsInMin: number, windowMin: number) {
  const elapsed = windowMin - clamp(resetsInMin, 0, windowMin)
  const used = 100 - left
  if (elapsed < FORECAST_AFTER_MIN || used <= 0) {
    return undefined
  }
  const empty = Math.round((left * elapsed) / used)

  return empty < resetsInMin ? empty : undefined
}

/** Minutes the prompt cache stays warm after the main thread's last turn ended at `endedAt`, 0 once cold. */
export function cacheLeftMin(endedAt: number | undefined, ttlMin: number, now: number) {
  if (endedAt === undefined || ttlMin <= 0) {
    return undefined
  }

  return Math.max(0, Math.ceil((ttlMin * 60000 - (now - endedAt)) / 60000))
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
// The even-pace mark on a bar. Light, so it shows on the bar's dark track and on its fill.
export const MARKER_COLOR = 0xf1f5f9

const darker = (c: number) => [16, 8, 0].reduce((out, s) => out | (Math.round(channel(c, s) * 0.6) << s), 0)

/** A bevelled bar `w` cells long: grey end caps, a gradient fill with a darker lower half, and a mark at `markPct` when given. */
export function barCanvas(pct: number, [from, to]: Pair, markPct?: number, w = BAR_W): Canvas {
  const px = new Array<number>(w * 2).fill(0x1b1e26)
  const fill = Math.round((clamp(pct, 0, 100) / 100) * (w - 2))
  for (let i = 0; i < fill; i++) {
    const c = mix(from, to, i / (w - 3))
    px[1 + i] = c
    px[w + 1 + i] = darker(c)
  }
  for (const x of [0, w - 1]) {
    px[x] = 0x6f7787
    px[w + x] = 0x6f7787
  }
  if (markPct !== undefined) {
    const x = Math.min(1 + Math.round((clamp(markPct, 0, 100) / 100) * (w - 2)), w - 2)
    px[x] = MARKER_COLOR
    px[w + x] = MARKER_COLOR
  }

  return { w, h: 2, px }
}

/** One run of a row's text. The reading is bold in its bar's color; the details beside it are grey. */
export type HudPart = { text: string; color: string; bold?: boolean }

/** One bar's row: `pct` is its reading, `bar` its pixels, and `cells` those pixels as Raster cells. */
export type HudRow = { key: string; label: string; color: string; pct: number; bar: Canvas; cells: string; parts: HudPart[] }

// A mid grey, so the details read on a dark terminal and on a light one.
export const DETAIL_COLOR = '#8b93b8'

const cssColor = (c: number) => `#${c.toString(16).padStart(6, '0')}`
const reading = (text: string, [, bright]: Pair): HudPart => ({ text: ` ${text}`, color: cssColor(bright), bold: true })
const detail = (bits: (string | undefined)[]): HudPart[] => {
  const text = bits.filter(b => b !== undefined).join('  ')

  return text ? [{ text: `  ${text}`, color: DETAIL_COLOR }] : []
}

const resets = (min: number | undefined) => (min === undefined ? undefined : `reset in ${fmtMin(min)}`)
const shortReset = (min: number | undefined) => (min === undefined ? undefined : fmtMin(min))
const cache = (min: number | undefined) => (min === undefined ? undefined : min > 0 ? `cache ${fmtMin(min)}` : 'cache cold')
const evenLeft = (resetsInMin: number | undefined, windowMin: number) =>
  resetsInMin === undefined ? undefined : (clamp(resetsInMin, 0, windowMin) / windowMin) * 100
const pace = (left: number, resetsInMin: number | undefined, windowMin: number) => {
  if (resetsInMin === undefined) {
    return undefined
  }
  const spare = spareOf(left, resetsInMin, windowMin)

  return spare === 0 ? 'on pace' : spare > 0 ? `${spare}% spare` : `${-spare}% over`
}
/** The red warning that a limit runs out before its reset. */
const runsOut = (min: number | undefined): HudPart[] => (min === undefined ? [] : [{ text: `  empty ~${fmtMin(min)}`, color: cssColor(RED[1]) }])

const pairOf = (fill: [string, string] | undefined, fallback: Pair): Pair => (fill ? [parseInt(fill[0].slice(1), 16), parseInt(fill[1].slice(1), 16)] : fallback)

/**
 * The HUD's rows: HP, and MP and ST when the session has their readings, each in the pet's `look` unless
 * the look hides it. A bar's warning colors (yellow and red) replace its fill whatever the look. `isRow` lays
 * them side by side: shorter bars, and beside each reading only one short detail, or its warning. `barW` sets
 * the bars' width in cells, for a HUD that must fit a narrow terminal.
 */
export function hudRows(h: Hud, look: HudLook = {}, isRow = false, barW?: number): HudRow[] {
  const w = barW ?? (isRow ? ROW_BAR_W : BAR_W)
  const rows: (Omit<HudRow, 'cells'> & { look: BarLook | false | undefined })[] = []
  const hpFill = h.hp > 50 ? pairOf(look.hp ? look.hp.fill : undefined, GREEN) : h.hp > 25 ? YELLOW : RED
  rows.push({
    key: 'hp',
    look: look.hp,
    label: h.hp < LOW_HP ? '⚠ HP' : '♥ HP',
    color: '#f87171',
    pct: h.hp,
    bar: barCanvas(h.hp, hpFill, undefined, w),
    parts: [
      reading(`${h.hp}%`, hpFill),
      ...(h.hp < LOW_HP ? [{ ...reading('/compact', RED), text: '  /compact' }] : []),
      ...(isRow && h.hp < LOW_HP ? [] : detail([cache(h.cacheMin)])),
    ],
  })
  if (h.mp !== undefined) {
    const mpFill = h.mp < 15 ? RED : pairOf(look.mp ? look.mp.fill : undefined, BLUE)
    // Running out before the reset says more than how far over pace MP is, so it takes that place.
    const empty = h.mpResetsInMin === undefined ? undefined : emptyInMin(h.mp, h.mpResetsInMin, MP_WINDOW_MIN)
    rows.push({
      key: 'mp',
      look: look.mp,
      label: '✦ MP',
      color: '#7aa7ff',
      pct: h.mp,
      bar: barCanvas(h.mp, mpFill, evenLeft(h.mpResetsInMin, MP_WINDOW_MIN), w),
      parts: isRow
        ? [reading(`${h.mp}%`, mpFill), ...(empty === undefined ? detail([shortReset(h.mpResetsInMin)]) : runsOut(empty))]
        : [
            reading(`${h.mp}%`, mpFill),
            ...detail([resets(h.mpResetsInMin), empty === undefined ? pace(h.mp, h.mpResetsInMin, MP_WINDOW_MIN) : undefined]),
            ...runsOut(empty),
          ],
    })
  }
  if (h.st !== undefined) {
    const stFill = h.st < 15 ? RED : pairOf(look.st ? look.st.fill : undefined, GOLD)
    rows.push({
      key: 'st',
      look: look.st,
      label: '◆ ST',
      color: '#fbbf24',
      pct: h.st,
      bar: barCanvas(h.st, stFill, evenLeft(h.stResetsInMin, ST_WINDOW_MIN), w),
      parts: [reading(`${h.st}%`, stFill), ...detail(isRow ? [shortReset(h.stResetsInMin)] : [resets(h.stResetsInMin), pace(h.st, h.stResetsInMin, ST_WINDOW_MIN)])],
    })
  }
  const shown = rows
    .filter(r => r.look !== false)
    .map(({ look: bar, ...r }) => (bar ? { ...r, label: bar.label ?? r.label, color: bar.color ?? r.color } : r))
  // Stacked, labels pad to one width, so the bars line up.
  const width = isRow ? 0 : Math.max(0, ...shown.map(r => [...r.label].length))

  return shown.map(r => ({ ...r, label: r.label + ' '.repeat(Math.max(0, width - [...r.label].length)), cells: encodeCells(r.bar) }))
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

/** The cells between bars laid in a row. */
export const ROW_GAP = ' │ '

/** The width in cells of `rows` laid in a row, one line with no window: each label, bar and text, and the gaps between them. */
export const hudRowWidth = (rows: HudRow[]) =>
  rows.reduce((n, r) => n + [...r.label].length + 1 + r.bar.w + r.parts.reduce((m, p) => m + [...p.text].length, 0), 0) + ROW_GAP.length * (rows.length - 1)

/** The HUD window's width in cells, sides included: room for a label, a bar and the longest row's text. */
export const HUD_WINDOW_W = 64

/** The cells a compact row needs beside its bar: the margin, a label, a gap, a reading and one short detail. */
const COMPACT_TEXT_W = 19
const COMPACT_MIN_BAR_W = 4
/** Under this many columns the HUD draws nothing: a bar would be too short to read. */
export const COMPACT_MIN_W = 16

/**
 * The bar width of the compact HUD, one bar a line with no window, for a terminal narrower than the window, such
 * as a pane split beside others: the row's bar width when it fits, shorter down to four cells, none under
 * COMPACT_MIN_W columns. Text past the edge is cut, never wrapped.
 */
export function compactBarW(columns: number): number | undefined {
  if (columns < COMPACT_MIN_W) {
    return undefined
  }

  return Math.max(COMPACT_MIN_BAR_W, Math.min(ROW_BAR_W, columns - COMPACT_TEXT_W))
}
