import { expect, test } from 'claude-code/testing'
import type { SessionUsage } from 'claude-code'

import { BAR_W, DETAIL_COLOR, ROW_BAR_W, compactBarW, hudRowWidth, LOW_HP, contextAlert, contextAlertText, HUD_WINDOW_W, MARKER_COLOR, barCanvas, cacheLeftMin, emptyInMin, fmtMin, frameColor, hudFrom, hudRows, mood, spareOf, windowEdges } from './hud'

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
  expect(rows.map(text)).toEqual(['♥ HP 86%', '✦ MP 62%  reset in 2h13m  18% spare', '◆ ST 64%  reset in 3d2h  20% spare'])
  expect(text(hudRows({ hp: 8 })[0]!)).toBe('⚠ HP 8%  /compact')
  expect(text(hudRows({ hp: 19 })[0]!)).toBe('⚠ HP 19%  /compact')
  expect(text(hudRows({ hp: LOW_HP })[0]!)).toBe(`♥ HP ${LOW_HP}%`)
})

test('the low-context alert fires once as HP drops under the line, and again only after HP climbs well back', () => {
  let armed = true
  const seen: boolean[] = []
  for (const hp of [40, 25, 19, 15, 12, 25, 29, 60, 18, 10]) {
    const next = contextAlert(armed, hp)
    seen.push(next.alert)
    armed = next.armed
  }
  expect(seen).toEqual([false, false, true, false, false, false, false, false, true, false])
  expect(contextAlertText(18)).toContain('18% of the context left')
  expect(contextAlertText(18)).toContain('/compact')
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

test('the spare is how far a limit is ahead of an even pace through its window', () => {
  expect(spareOf(81, 4320, 10080)).toBe(38)
  expect(spareOf(99, 272, 300)).toBe(8)
  expect(spareOf(30, 200, 300)).toBe(-37)
  expect(spareOf(50, 20000, 10080)).toBe(-50)
})

test('MP runs out before its reset only at a burn faster than the window allows, and not in its first minutes', () => {
  expect(emptyInMin(40, 180, 300)).toBe(80)
  expect(emptyInMin(90, 150, 300)).toBeUndefined()
  expect(emptyInMin(80, 290, 300)).toBeUndefined()
  expect(emptyInMin(100, 100, 300)).toBeUndefined()
  expect(emptyInMin(0, 100, 300)).toBe(0)
})

test('the cache counts down from the last main turn, and goes cold at its TTL', () => {
  expect(cacheLeftMin(undefined, 60, 0)).toBeUndefined()
  expect(cacheLeftMin(0, 0, 60000)).toBeUndefined()
  expect(cacheLeftMin(0, 60, 8 * 60000)).toBe(52)
  expect(cacheLeftMin(0, 60, 8 * 60000 + 1)).toBe(52)
  expect(cacheLeftMin(0, 5, 5 * 60000)).toBe(0)
  expect(cacheLeftMin(0, 5, 9 * 60000)).toBe(0)
})

test('a bar marks its even pace with a light column across both pixel rows', () => {
  const bar = barCanvas(81, [0xb45309, 0xfbbf24], 43)
  const x = 1 + Math.round(0.43 * (BAR_W - 2))
  expect([bar.px[x], bar.px[BAR_W + x]]).toEqual([MARKER_COLOR, MARKER_COLOR])
  expect(barCanvas(81, [0xb45309, 0xfbbf24]).px.includes(MARKER_COLOR)).toBe(false)
})

test('HP shows the cache left, MP its spare or when it runs out, ST its spare or overrun', () => {
  const text = (r: ReturnType<typeof hudRows>[number]) => r.label + r.parts.map(p => p.text).join('')
  expect(hudRows({ hp: 96, cacheMin: 52, mp: 99, mpResetsInMin: 272, st: 81, stResetsInMin: 4320 }).map(text)).toEqual([
    '♥ HP 96%  cache 52m',
    '✦ MP 99%  reset in 4h32m  8% spare',
    '◆ ST 81%  reset in 3d0h  38% spare',
  ])
  expect(text(hudRows({ hp: 90, cacheMin: 0 })[0]!)).toBe('♥ HP 90%  cache cold')
  const [, mp, st] = hudRows({ hp: 90, mp: 40, mpResetsInMin: 180, st: 20, stResetsInMin: 5040 })
  expect(text(mp!)).toBe('✦ MP 40%  reset in 3h00m  empty ~1h20m')
  expect(mp!.parts.at(-1)).toEqual({ text: '  empty ~1h20m', color: '#f87171' })
  expect(text(st!)).toBe('◆ ST 20%  reset in 3d12h  30% over')
  expect(text(hudRows({ hp: 90, mp: 70, mpResetsInMin: 210 })[1]!)).toBe('✦ MP 70%  reset in 3h30m  on pace')
})

test('the longest rows fit inside the HUD window', () => {
  const huds = [
    { hp: 5, cacheMin: 59, mp: 40, mpResetsInMin: 239, st: 3, stResetsInMin: 10079 },
    { hp: 100, cacheMin: 0, mp: 100, mpResetsInMin: 299, st: 100, stResetsInMin: 1439 },
  ]
  const look = { hp: { label: '☢ FUEL' }, mp: { label: 'MANA!!' }, st: { label: 'STAMNA' } }
  for (const h of huds) {
    for (const r of hudRows(h, look)) {
      expect([...r.label].length + 1 + BAR_W + r.parts.map(p => [...p.text].length).reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(HUD_WINDOW_W - 3)
    }
  }
})

test('in a row each bar is shorter and keeps only its reading and one short detail', () => {
  const rows = hudRows({ hp: 100, cacheMin: 52, mp: 92, mpResetsInMin: 129, st: 74, stResetsInMin: 3540 }, {}, true)
  const text = (r: (typeof rows)[number]) => r.label + r.parts.map(p => p.text).join('')
  expect(rows.map(text)).toEqual(['♥ HP 100%  cache 52m', '✦ MP 92%  2h09m', '◆ ST 74%  2d11h'])
  expect(rows.every(r => r.bar.w === ROW_BAR_W)).toBe(true)
  // The warnings stay: /compact for HP, and MP running out in place of its reset.
  const low = hudRows({ hp: 12, cacheMin: 3, mp: 30, mpResetsInMin: 200 }, {}, true)
  expect(low.map(text)).toEqual(['⚠ HP 12%  /compact', '✦ MP 30%  empty ~43m'])
})

test('a row has no window: it is as wide as its labels, bars, text, and the gaps between them', () => {
  const rows = hudRows({ hp: 100, cacheMin: 52, mp: 92, mpResetsInMin: 129, st: 74, stResetsInMin: 3540 }, {}, true)
  const content = rows.reduce((n, r) => n + [...r.label].length + 1 + ROW_BAR_W + r.parts.reduce((m, p) => m + [...p.text].length, 0), 0)
  expect(hudRowWidth(rows)).toBe(content + 3 * (rows.length - 1))
})

test('a HUD narrower than its window shrinks its bars to fit, down to four cells, and has none under 16 columns', () => {
  expect([compactBarW(40), compactBarW(28), compactBarW(22), compactBarW(16), compactBarW(15)]).toEqual([ROW_BAR_W, 9, 4, 4, undefined])
  expect(hudRows({ hp: 80, mp: 50, mpResetsInMin: 90 }, {}, true, 6).map(r => r.bar.w)).toEqual([6, 6])
})
