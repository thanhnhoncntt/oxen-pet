import { expect, test } from 'claude-code/testing'
import type { SessionUsage } from 'claude-code'

import { BAR_W, DETAIL_COLOR, HUD_WINDOW_W, barCanvas, fmtMin, frameColor, hudFrom, hudRows, mood, windowEdges } from './hud'

const usage = (over: Partial<SessionUsage> = {}): SessionUsage => ({
  startedAt: 0,
  context: { window: 200000, percent: 14 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 38, resetsAt: '1970-01-01T02:13:00Z' },
    { kind: 'seven_day', percentUsed: 36, resetsAt: '1970-01-04T04:36:00Z' },
  ],
  ...over,
})

test('HP is the context left, MP the five-hour limit left, ST the seven-day one, each with its reset in minutes', () => {
  expect(hudFrom(usage(), 36 * 60000)).toEqual({ hp: 86, mp: 62, mpResetsInMin: 97, st: 64, stResetsInMin: 4560 })
})

test('off a subscription there is no MP or ST; before the first response the context is full', () => {
  const h = hudFrom(usage({ rateLimits: [], context: { window: 200000 } }), 0)
  expect([h.mp, h.st]).toEqual([undefined, undefined])
  expect(h.hp).toBe(100)
  expect(hudRows(h).map(r => r.key)).toEqual(['hp'])
})

test('the face follows HP first, then MP or ST', () => {
  expect([90, 50, 20].map(hp => mood({ hp, mp: 80 }))).toEqual(['ok', 'worried', 'critical'])
  expect(mood({ hp: 90, mp: 10 })).toBe('tired')
  expect(mood({ hp: 90, mp: 80, st: 10 })).toBe('tired')
})

test('times read as minutes, then hours, then days', () => {
  expect([fmtMin(36), fmtMin(133), fmtMin(4440)]).toEqual(['36m', '2h13m', '3d2h'])
})

test('a bar fills in proportion and keeps its end caps', () => {
  const full = barCanvas(100, [0x166534, 0x4ade80])
  const empty = barCanvas(0, [0x166534, 0x4ade80])
  expect(full.px.filter(c => c === 0x1b1e26)).toHaveLength(0)
  expect(empty.px.filter(c => c === 0x1b1e26)).toHaveLength((BAR_W - 2) * 2)
  expect(empty.px[0]).toBe(0x6f7787)
})

test('the rows name every stat, and HP warns when context runs out', () => {
  const rows = hudRows({ hp: 86, mp: 62, mpResetsInMin: 133, st: 64, stResetsInMin: 4476 })
  const text = (r: (typeof rows)[number]) => r.label + r.parts.map(p => p.text).join('')
  expect(rows.map(text)).toEqual(['♥ HP 86%', '✦ MP 62%  reset in 2h13m', '◆ ST 64%  reset in 3d2h'])
  expect(text(hudRows({ hp: 8 })[0]!)).toBe('⚠ HP 8%  /compact')
})

test('the reading is bold in its bar\'s color and the details are grey', () => {
  const [hp, mp, st] = hudRows({ hp: 30, mp: 10, mpResetsInMin: 5, st: 70, stResetsInMin: 900 })
  expect(hp!.parts).toEqual([{ text: ' 30%', color: '#facc15', bold: true }])
  expect(mp!.parts.map(p => p.color)).toEqual(['#f87171', DETAIL_COLOR])
  expect(st!.parts[0]).toEqual({ text: ' 70%', color: '#fbbf24', bold: true })
})

test('HP rounds to a whole percent, and a usage number that is not finite reads as unknown', () => {
  expect(hudFrom(usage({ context: { window: 200000, percent: 12.7 } }), 0).hp).toBe(87)
  expect(hudFrom(usage({ context: { window: 200000, percent: Number.NaN } }), 0).hp).toBe(100)
  expect(hudFrom(usage({ rateLimits: [{ kind: 'five_hour', percentUsed: Number.NaN }] }), 0).mp).toBeUndefined()
})

test('each limit shows only with its own reading', () => {
  const h = hudFrom(usage({ rateLimits: [{ kind: 'seven_day', percentUsed: 70 }] }), 0)
  expect([h.mp, h.st, h.stResetsInMin]).toEqual([undefined, 30, undefined])
  expect(hudRows(h).map(r => r.key)).toEqual(['hp', 'st'])
})

test('the window edges span its width, with the corners left empty', () => {
  const { top, bottom } = windowEdges(HUD_WINDOW_W)
  expect([...top].length).toBe(HUD_WINDOW_W)
  expect([...bottom].length).toBe(HUD_WINDOW_W)
  expect([top.at(0), top.at(-1), bottom.at(0), bottom.at(-1)]).toEqual([' ', ' ', ' ', ' '])
})

test("a pet's HUD look relabels, recolors, and hides bars, and keeps the warning colors", () => {
  const h = { hp: 80, mp: 50, mpResetsInMin: 60, st: 10, stResetsInMin: 600 }
  const rows = hudRows(h, { hp: { label: '☢ FUEL', color: '#00ff88', fill: ['#003300', '#00ff88'] }, mp: false, st: { fill: ['#000000', '#ffffff'] } })
  expect(rows.map(r => r.key)).toEqual(['hp', 'st'])
  expect(rows.map(r => r.label)).toEqual(['☢ FUEL', '◆ ST  '])
  expect(rows[0]?.color).toBe('#00ff88')
  expect(rows[0]?.parts[0]?.color).toBe('#00ff88')
  expect(rows[1]?.parts[0]?.color).toBe('#f87171')
  expect(hudRows(h, { hp: false, mp: false, st: false })).toEqual([])
  expect(frameColor({ frame: '#44cc44' })).toBe('#44cc44')
  expect(frameColor({})).toBe('#5aa9ff')
})
