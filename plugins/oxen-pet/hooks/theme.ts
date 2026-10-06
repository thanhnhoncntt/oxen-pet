import type { Mode } from '../types'
import type { BarLook, HudLook } from './hud'
import { BODY_W, EYE_COLOR, HEIGHT, MINI_SIZE, MODES, PROP_W } from './pixels'
import type { Body, BodyFrame, Look } from './pixels'
import { EVERY, SCENE_SIZE } from './scene'
import type { Scene } from './scene'

/** A theme as its file spells it: the pet's sprite and everything else it changes. `skills/oxen-pet/FORMAT.md` documents each field for the people who write one. */
export type Theme = {
  name: string
  scale: number
  squash: number // how much the poses squash and stretch the sprite: 1 fully, 0 not at all, so it only lifts
  sprite: string[]
  palette: Record<string, string>
  outline?: string
  eyes?: [[number, number], [number, number]] // absent: no eyes and no faces
  eyeColor: string
  cheeks?: [[number, number], [number, number]]
  cheekColor?: string
  mini: { top: string; body: string; edge: string }
  miniSprite?: string[]
  props: Body['props']
  scene?: Scene
  forms: Partial<Record<Mode, Form>> // how the pet looks in a mode, in place of its own sprite fields
} & Look

/** The sprite fields a form sets for one mode; those it leaves out are the pet's own. */
export type Form = Pick<Theme, 'scale' | 'squash' | 'sprite' | 'palette' | 'outline' | 'eyes' | 'eyeColor' | 'cheeks' | 'cheekColor'>
const FORM_KEYS = ['sprite', 'palette', 'scale', 'squash', 'outline', 'eyes', 'eyeColor', 'cheeks', 'cheekColor'] as const

// The frames mark cheeks and sparkles, and the resting frame pupils, with characters a palette may not use.
const CHEEK_MARK = '*'
const SPARKLE_MARK = '+'
const PUPIL_MARK = '@'
const RESERVED = ['.', CHEEK_MARK, SPARKLE_MARK, PUPIL_MARK]
const SPARKLE_COLOR = 0xffe25a
const SLIME_MINI = { top: '#9ad2ff', body: '#3d84f0', edge: '#1e3a8a' }
const PROP_SIZE = { w: PROP_W, h: HEIGHT }
const MAX_PROP_FRAMES = 8
const MAX_LINE = 40 // characters in a status line, so it fits beside the pet
const MAX_LABEL = 6 // characters in a HUD label, so the HUD fits its window
const BARS = ['hp', 'mp', 'st'] as const

// Each pose squashes the sprite by sx, sy and lifts it by dy pixels, all before `scale`. The run and jump poses
// also carry an eye hint. Tuned on the slime; any pet that fits the canvas reuses them.
type Pose = [sx: number, sy: number, dy: number, hint?: string]
const STAND: Pose[] = Array.from({ length: 16 }, (_, i) => {
  const s = (1 - Math.cos((2 * Math.PI * i) / 16)) / 2
  return [1 + 0.06 * s, 1 - 0.09 * s, 0]
})
const RUN: Pose[] = [[1.18, 0.74, 0, 'open'], [0.86, 1.22, 1, 'wide'], [0.9, 1.15, 4, 'wide'], [0.95, 1.05, 6, 'open'], [0.92, 1.12, 4, 'open'], [0.9, 1.18, 1, 'open'], [1.22, 0.7, 0, 'bar'], [1.08, 0.9, 0, 'open']]
const JUMP: Pose[] = [[1.15, 0.8, 0, 'open'], [1.22, 0.7, 0, 'bar'], [0.85, 1.25, 2, 'wide'], [0.88, 1.2, 5, 'wide'], [0.92, 1.12, 8, 'wide'], [0.96, 1.04, 9, 'open'], [1, 1, 9, 'open'],
  [0.96, 1.04, 8, 'open'], [0.92, 1.1, 6, 'open'], [0.9, 1.15, 3, 'open'], [0.9, 1.2, 1, 'open'], [1.25, 0.68, 0, 'bar'], [1.12, 0.85, 0, 'bar'], [1.04, 0.95, 0, 'open']]
const THINK: Pose[] = Array.from({ length: 12 }, (_, i) => {
  const wobble = 1 + 0.03 * Math.sin((2 * Math.PI * i) / 6)
  return [wobble, 2 - wobble, 0]
})
const CHEER: Pose[] = [[1, 1, 0], [1.18, 0.8, 0], [0.9, 1.18, 2], [0.95, 1.08, 4], [0.98, 1.02, 4], [0.92, 1.12, 2], [1.2, 0.76, 0], [0.88, 1.2, 2], [0.95, 1.08, 4],
  [0.98, 1.02, 4], [0.92, 1.12, 2], [1.2, 0.76, 0], [0.88, 1.2, 2], [0.95, 1.08, 4], [0.98, 1.02, 4], [0.92, 1.12, 2], [1.2, 0.76, 0], [1, 1, 0]]
const POSES = [...STAND, ...RUN, ...JUMP, ...THINK, ...CHEER]

function sparkle(x: number, y: number, isBig: boolean): [number, number][] {
  return isBig ? [[x, y], [x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]] : [[x, y]]
}

const cheerSparkles = (i: number) =>
  i % 3 ? [...sparkle(2, 8, i % 2 === 0), ...sparkle(16, 6, i % 2 === 1)] : [...sparkle(3, 6, true), ...sparkle(15, 9, false)]

// Round half to even. The frames theme.test.ts pins depend on it.
function roundHalfEven(v: number) {
  const r = Math.round(v)
  return Math.abs(v % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r
}

/** The largest sprite, in pixels, that fits the canvas in every pose at `scale`. */
export function maxSize(scale: number) {
  return {
    w: Math.floor(Math.min(...POSES.map(([sx]) => BODY_W / (sx * scale))) + 1e-9),
    h: Math.floor(Math.min(...POSES.map(([, sy, dy]) => (HEIGHT / scale - dy) / sy)) + 1e-9),
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isPoint = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2 && v.every(n => Number.isInteger(n))
const isPair = (v: unknown): v is [[number, number], [number, number]] => Array.isArray(v) && v.length === 2 && v.every(isPoint)

/** `#rrggbb` from `#rrggbb` or `#rgb`, or undefined for anything else. */
function color(v: unknown) {
  if (typeof v !== 'string') {
    return undefined
  }
  if (/^#[0-9a-fA-F]{6}$/.test(v)) {
    return v.toLowerCase()
  }

  return /^#[0-9a-fA-F]{3}$/.test(v) ? `#${[...v.slice(1)].map(c => c + c).join('')}`.toLowerCase() : undefined
}

/** The largest scale, up to `scale`, at which a w×h sprite fits the canvas in every pose. */
function fitScale(w: number, h: number, scale: number) {
  const fits = Math.min(scale, ...POSES.map(([sx, sy, dy]) => Math.min(BODY_W / (sx * w), HEIGHT / (dy + sy * h))))

  return fits < scale ? Math.floor(fits * 100) / 100 : scale
}

/** Rows drawn in the pet's palette, cut to `max`, or undefined when `v` is not rows. Notes say what changed. */
function paletteRows(v: unknown, max: { w: number; h: number }, palette: Record<string, string>, what: string, notes: string[]) {
  if (!Array.isArray(v) || !v.some(r => typeof r === 'string' && r.length > 0)) {
    notes.push(`${what} is not a list of text rows, so it is left out.`)
    return undefined
  }
  let rows = v.map(r => (typeof r === 'string' ? r : ''))
  const w = Math.max(...rows.map(r => r.length))
  if (w > max.w || rows.length > max.h) {
    notes.push(`${what} is ${w}×${rows.length}, past the largest, ${max.w}×${max.h}, so its bottom-left part is kept.`)
    rows = rows.slice(-max.h).map(r => r.slice(0, max.w))
  }
  rows = rows.map(r => r.padEnd(Math.min(w, max.w), '.'))
  if (rows.some(r => /[*+@]/.test(r))) {
    notes.push(`In ${what}, "*", "+", "@" pixels are drawn clear: the mod marks its own drawings with them.`)
    rows = rows.map(r => r.replace(/[*+@]/g, '.'))
  }
  const uncolored = [...new Set(rows.join(''))].filter(c => c !== '.' && !(c in palette))
  if (uncolored.length > 0) {
    notes.push(`In ${what}, ${uncolored.map(c => `"${c}"`).join(', ')} has no palette color, so it is drawn clear.`)
  }

  return rows
}

/** The pet's own props by mode: frames of rows, or null for no prop. */
function readProps(v: unknown, palette: Record<string, string>, notes: string[]) {
  const props: Body['props'] = {}
  if (v === undefined) {
    return props
  }
  if (!isObject(v)) {
    notes.push('`props` maps a mode to its prop, so it is left out.')
    return props
  }
  for (const [mode, value] of Object.entries(v)) {
    if (!(mode in MODES) || mode === 'run') {
      notes.push(`"${mode}" in \`props\` is not a mode that can hold a prop, so it is left out.`)
      continue
    }
    if (value === false || value === null) {
      props[mode as Mode] = null
      continue
    }
    const frames = Array.isArray(value) && value.length > 0 && value.every(Array.isArray) ? value : [value]
    if (frames.length > MAX_PROP_FRAMES) {
      notes.push(`The ${mode} prop keeps its first ${MAX_PROP_FRAMES} frames.`)
    }
    const kept = frames
      .slice(0, MAX_PROP_FRAMES)
      .map((f, i) => paletteRows(f, PROP_SIZE, palette, frames.length > 1 ? `frame ${i + 1} of the ${mode} prop` : `the ${mode} prop`, notes))
      .filter((f): f is string[] => f !== undefined)
    if (kept.length > 0) {
      props[mode as Mode] = kept
    }
  }

  return props
}

/** Status lines or line colors by mode, each value checked by `read`. */
function byMode<T>(v: unknown, field: string, read: (value: unknown, mode: string) => T | undefined, notes: string[]) {
  const out: Partial<Record<Mode, T>> = {}
  if (v === undefined) {
    return out
  }
  if (!isObject(v)) {
    notes.push(`\`${field}\` maps a mode to its value, so it is left out.`)
    return out
  }
  for (const [mode, value] of Object.entries(v)) {
    if (!(mode in MODES)) {
      notes.push(`"${mode}" in \`${field}\` is not a mode, so it is left out.`)
      continue
    }
    const kept = read(value, mode)
    if (kept !== undefined) {
      out[mode as Mode] = kept
    }
  }

  return out
}

function readLines(v: unknown, notes: string[]) {
  return byMode(v, 'lines', (value, mode) => {
    const lines = (Array.isArray(value) ? value : [value]).filter((l): l is string => typeof l === 'string' && l.trim() !== '').map(l => l.trim())
    if (lines.length === 0) {
      notes.push(`\`lines.${mode}\` has no text, so the ${mode} mode keeps its own lines.`)
      return undefined
    }
    if (lines.some(l => l.length > MAX_LINE)) {
      notes.push(`Lines in \`lines.${mode}\` are cut to ${MAX_LINE} characters.`)
    }
    return lines.map(l => l.slice(0, MAX_LINE))
  }, notes)
}

function readLineColors(v: unknown, notes: string[]) {
  return byMode(v, 'lineColors', (value, mode) => {
    const c = color(value)
    if (c === undefined) {
      notes.push(`\`lineColors.${mode}\`, ${JSON.stringify(value)}, is not "#rrggbb", so the ${mode} mode keeps its own color.`)
    }
    return c
  }, notes)
}

function readHud(v: unknown, notes: string[]) {
  const hud: HudLook = {}
  if (v === undefined) {
    return hud
  }
  if (!isObject(v)) {
    notes.push('`hud` is an object, so the HUD keeps its own look.')
    return hud
  }
  if (v.frame !== undefined) {
    hud.frame = color(v.frame)
    if (hud.frame === undefined) {
      notes.push(`\`hud.frame\`, ${JSON.stringify(v.frame)}, is not "#rrggbb", so the frame keeps its own color.`)
    }
  }
  for (const key of BARS) {
    const b = v[key]
    if (b === undefined) {
      continue
    }
    if (b === false) {
      hud[key] = false
      continue
    }
    if (!isObject(b)) {
      notes.push(`\`hud.${key}\` is an object or false, so that bar keeps its own look.`)
      continue
    }
    const look: BarLook = {}
    if (typeof b.label === 'string' && b.label.trim() !== '') {
      const label = [...b.label.trim()]
      if (label.length > MAX_LABEL) {
        notes.push(`\`hud.${key}.label\` is cut to ${MAX_LABEL} characters.`)
      }
      look.label = label.slice(0, MAX_LABEL).join('')
    }
    if (b.color !== undefined) {
      look.color = color(b.color)
      if (look.color === undefined) {
        notes.push(`\`hud.${key}.color\` is not "#rrggbb", so the label keeps its own color.`)
      }
    }
    if (b.fill !== undefined) {
      const fill = Array.isArray(b.fill) && b.fill.length === 2 ? b.fill.map(color) : []
      if (fill[0] !== undefined && fill[1] !== undefined) {
        look.fill = [fill[0], fill[1]]
      } else {
        notes.push(`\`hud.${key}.fill\` is two "#rrggbb" colors, so the bar keeps its own fill.`)
      }
    }
    hud[key] = look
  }

  return hud
}

/** A list of drawings in the pet's palette, each cut to `max`; at most SCENE_SIZE.items of them. */
function drawings(v: unknown, max: { w: number; h: number }, palette: Record<string, string>, what: string, notes: string[]) {
  if (v === undefined) {
    return []
  }
  const list = Array.isArray(v) && v.length > 0 && v.every(Array.isArray) ? v : [v]
  if (list.length > SCENE_SIZE.items) {
    notes.push(`\`${what}\` keeps its first ${SCENE_SIZE.items}.`)
  }

  return list
    .slice(0, SCENE_SIZE.items)
    .map((d, i) => paletteRows(d, max, palette, `\`${what}\` ${i + 1}`, notes))
    .filter((d): d is string[] => d !== undefined)
}

function readScene(v: unknown, palette: Record<string, string>, notes: string[]): Scene | undefined {
  if (v === undefined) {
    return undefined
  }
  if (!isObject(v)) {
    notes.push('`scene` is an object, so the pet has no scene.')
    return undefined
  }
  const ground = v.ground === undefined ? undefined : paletteRows(v.ground, SCENE_SIZE.ground, palette, '`scene.ground`', notes)
  const sky = v.sky === undefined ? undefined : paletteRows(v.sky, SCENE_SIZE.sky, palette, '`scene.sky`', notes)
  const obstacles = drawings(v.obstacles, SCENE_SIZE.obstacle, palette, 'scene.obstacles', notes)
  const decor = drawings(v.decor, SCENE_SIZE.decor, palette, 'scene.decor', notes)
  if (!ground && !sky && obstacles.length === 0 && decor.length === 0) {
    notes.push('`scene` has no ground, sky, obstacles, or decor to draw, so the pet has no scene.')
    return undefined
  }
  let every = EVERY.normal
  if (v.every !== undefined) {
    const asked = typeof v.every === 'number' ? Math.round(v.every) : NaN
    every = Number.isNaN(asked) ? EVERY.normal : Math.min(EVERY.max, Math.max(EVERY.min, asked))
    if (every !== asked) {
      notes.push(`\`scene.every\` is a number of columns from ${EVERY.min} to ${EVERY.max}, so it is ${every}.`)
    }
  }

  return { ground, ...(sky && { sky }), obstacles, decor, every }
}

/**
 * A theme from a parsed theme file, or why there is none. Only a value with no sprite is refused. Anything else
 * draws: the mod repairs what it can and says what it did in `notes`, which the drawer may act on or ignore.
 */
export function readTheme(v: unknown): { theme: Theme; notes: string[]; errors?: undefined } | { errors: string[] } {
  if (!isObject(v)) {
    return { errors: ['A theme is a JSON object with a `sprite`.'] }
  }
  if (!Array.isArray(v.sprite) || !v.sprite.some(r => typeof r === 'string' && r.length > 0)) {
    return { errors: ['`sprite` is a list of text rows, one character per pixel.'] }
  }
  const notes: string[] = []
  const name = typeof v.name === 'string' && v.name.trim() !== '' ? v.name.trim().slice(0, 24) : 'pet'

  let rows = (v.sprite as unknown[]).map(r => (typeof r === 'string' ? r : ''))
  const w = Math.max(...rows.map(r => r.length))
  if (rows.some(r => r.length !== w)) {
    notes.push(`Rows of different widths were padded with "." to ${w}.`)
    rows = rows.map(r => r.padEnd(w, '.'))
  }
  if (rows.some(r => RESERVED.slice(1).some(c => r.includes(c)))) {
    notes.push(`The sprite's ${RESERVED.slice(1).map(c => `"${c}"`).join(', ')} pixels are drawn clear: the mod marks its own drawings with them.`)
    rows = rows.map(r => r.replace(/[*+@]/g, '.'))
  }
  const h = rows.length

  const palette: Record<string, string> = {}
  for (const [ch, value] of Object.entries(isObject(v.palette) ? v.palette : {})) {
    const c = color(value)
    if (c === undefined) {
      notes.push(`The palette color for "${ch}", ${JSON.stringify(value)}, is not "#rrggbb", so "${ch}" is drawn clear.`)
    } else if (!RESERVED.includes(ch)) {
      palette[ch] = c
    }
  }
  const uncolored = [...new Set(rows.join(''))].filter(c => c !== '.' && !(c in palette))
  if (uncolored.length > 0) {
    notes.push(`${uncolored.map(c => `"${c}"`).join(', ')} has no palette color, so it is drawn clear.`)
  }

  const asked = typeof v.scale === 'number' && v.scale > 0 ? v.scale : 1
  const scale = fitScale(w, h, asked)
  if (scale < asked) {
    notes.push(`A ${w}×${h} sprite is drawn at scale ${scale} to fit every pose. At scale 1 the largest is ${maxSize(1).w}×${maxSize(1).h}, and a smaller scale blurs detail.`)
  }

  let squash = 1
  if (v.squash !== undefined) {
    const isNumber = typeof v.squash === 'number' && Number.isFinite(v.squash)
    squash = isNumber ? Math.min(1, Math.max(0, v.squash as number)) : 1
    if (!isNumber || squash !== v.squash) {
      notes.push(`\`squash\` is a number from 0 to 1, so ${JSON.stringify(v.squash)} reads as ${squash}.`)
    }
  }

  const outline = typeof v.outline === 'string' && v.outline in palette ? v.outline : undefined
  const eyes = isPair(v.eyes) ? v.eyes : undefined
  if (v.eyes !== undefined && eyes === undefined) {
    notes.push('`eyes` is two [x, y] points, so the pet has no eyes and no faces.')
  }
  const inside = (x: number, y: number) => x >= 0 && x < w && y >= 0 && y < h
  for (const [x, y] of eyes ?? []) {
    if (!inside(x, y - 1) || !inside(x + 2, y + 1)) {
      notes.push(`The eye at [${x}, ${y}] draws its 3×3 box partly off the ${w}×${h} sprite.`)
    }
  }
  if (eyes && Math.abs(eyes[0][0] - eyes[1][0]) < 3 && Math.abs(eyes[0][1] - eyes[1][1]) < 3) {
    notes.push('The eye boxes overlap, so the wide eyes and hearts merge into one shape. Pupils 4 pixels apart keep them apart.')
  }
  const cheeks = isPair(v.cheeks) ? v.cheeks : undefined
  if (v.cheeks !== undefined && cheeks === undefined) {
    notes.push('`cheeks` is two [x, y] pixels, so the pet has no cheeks.')
  }
  const inEyeBox = ([x, y]: [number, number]) => (eyes ?? []).some(([ex, ey]) => x >= ex && x <= ex + 2 && y >= ey - 1 && y <= ey + 1)
  if (cheeks?.some(inEyeBox)) {
    notes.push('A cheek sits inside an eye box, where some faces draw over it.')
  }
  const mini = isObject(v.mini) ? { top: color(v.mini.top), body: color(v.mini.body), edge: color(v.mini.edge) } : undefined
  const hasMini = mini?.top !== undefined && mini.body !== undefined && mini.edge !== undefined
  if (v.mini !== undefined && !hasMini) {
    notes.push('`mini` needs three colors, `top`, `body`, and `edge`, so the minis keep the slime\'s blues.')
  }
  const miniSprite = v.miniSprite === undefined ? undefined : paletteRows(v.miniSprite, MINI_SIZE, palette, '`miniSprite`', notes)

  return {
    theme: {
      name,
      scale,
      squash,
      sprite: rows,
      palette,
      outline,
      eyes,
      eyeColor: color(v.eyeColor) ?? '#000000',
      cheeks,
      cheekColor: cheeks ? (color(v.cheekColor) ?? '#ff8aaa') : undefined,
      mini: hasMini ? (mini as Theme['mini']) : SLIME_MINI,
      miniSprite,
      props: readProps(v.props, palette, notes),
      lines: readLines(v.lines, notes),
      lineColors: readLineColors(v.lineColors, notes),
      hud: readHud(v.hud, notes),
      scene: readScene(v.scene, palette, notes),
      forms: readForms(v, notes),
    },
    notes,
  }
}

/**
 * The forms by mode. Each is read as a sprite of its own, from the pet's sprite fields with the form's over them and
 * the palettes merged, so a form may only recolor. Its notes say which form they are about, past those the pet's own
 * fields gave already.
 */
function readForms(v: Record<string, unknown>, notes: string[]): Theme['forms'] {
  const forms: Theme['forms'] = {}
  if (v.forms === undefined) {
    return forms
  }
  if (!isObject(v.forms)) {
    notes.push('`forms` maps a mode to its form, so it is left out.')
    return forms
  }
  const fields = (o: Record<string, unknown>) => Object.fromEntries(FORM_KEYS.filter(k => o[k] !== undefined).map(k => [k, o[k]]))
  const before = new Set(notes)
  for (const [mode, form] of Object.entries(v.forms)) {
    if (!(mode in MODES)) {
      notes.push(`"${mode}" in \`forms\` is not a mode, so it is left out.`)
      continue
    }
    if (!isObject(form)) {
      notes.push(`\`forms.${mode}\` is not an object of sprite fields, so it is left out.`)
      continue
    }
    const palette = { ...(isObject(v.palette) ? v.palette : {}), ...(isObject(form.palette) ? form.palette : {}) }
    const read = readTheme({ ...fields(v), ...fields(form), palette })
    if (read.errors) {
      notes.push(`forms.${mode}: ${read.errors.join(' ')}`)
      continue
    }
    notes.push(...read.notes.filter(n => !before.has(n)).map(n => `forms.${mode}: ${n}`))
    const t = read.theme
    forms[mode as Mode] = { scale: t.scale, squash: t.squash, sprite: t.sprite, palette: t.palette, outline: t.outline, eyes: t.eyes, eyeColor: t.eyeColor, cheeks: t.cheeks, cheekColor: t.cheekColor }
  }

  return forms
}

const colorOf = (color: string) => parseInt(color.slice(1), 16)

function poseFrame(theme: Form, pose: Pose, extra: [number, number][] = []): BodyFrame {
  // squash scales how far the pose bends the sprite; the lift stays whole.
  const bend = (f: number) => 1 + (f - 1) * theme.squash
  const [sx, sy, dy] = [bend(pose[0]) * theme.scale, bend(pose[1]) * theme.scale, pose[2] * theme.scale]
  const sw = (theme.sprite[0] as string).length
  const sh = theme.sprite.length
  const cx = sw / 2
  const tcx = sw % 2 ? BODY_W / 2 : Math.floor(BODY_W / 2) // whole-pixel aligned, so at scale 1 a resting sprite is copied, not resampled
  const tb = HEIGHT - dy
  const g = Array.from({ length: HEIGHT }, () => new Array<string>(BODY_W).fill('.'))
  const put = (x: number, y: number, ch: string) => {
    const [px, py] = [roundHalfEven(x), roundHalfEven(y)]
    if (px >= 0 && px < BODY_W && py >= 0 && py < HEIGHT) {
      ;(g[py] as string[])[px] = ch
    }
  }
  // Each canvas pixel takes the sprite color that covers most of it; the outline counts extra, so it survives a squash.
  for (let ty = 0; ty < HEIGHT; ty++) {
    for (let tx = 0; tx < BODY_W; tx++) {
      const u0 = cx + (tx - tcx) / sx
      const u1 = cx + (tx + 1 - tcx) / sx
      const v0 = sh - (tb - ty) / sy
      const v1 = sh - (tb - ty - 1) / sy
      const cover = new Map<string, number>()
      for (let v = Math.max(0, Math.floor(v0)); v < Math.min(sh, Math.ceil(v1)); v++) {
        for (let u = Math.max(0, Math.floor(u0)); u < Math.min(sw, Math.ceil(u1)); u++) {
          const area = (Math.min(u1, u + 1) - Math.max(u0, u)) * (Math.min(v1, v + 1) - Math.max(v0, v))
          const ch = (theme.sprite[v] as string)[u] as string
          if (area > 0 && ch !== '.') {
            cover.set(ch, (cover.get(ch) ?? 0) + area * (ch === theme.outline ? 1.6 : 1))
          }
        }
      }
      let total = 0
      let best = ''
      for (const [ch, area] of cover) {
        total += area
        if (best === '' || area > (cover.get(best) as number)) {
          best = ch
        }
      }
      if (best !== '' && total >= 0.45 * (u1 - u0) * (v1 - v0)) {
        ;(g[ty] as string[])[tx] = best
      }
    }
  }
  const at = ([x, y]: [number, number]) => [tcx + (x - cx) * sx, tb - (sh - y) * sy] as const
  for (const [x, y] of theme.cheeks ?? []) {
    const [px, py] = at([x + 0.5, y + 0.5])
    put(px - 0.5, py - 0.5, CHEEK_MARK)
  }
  for (const [x, y] of extra) {
    put(x, y, SPARKLE_MARK)
  }
  const [l, r] = (theme.eyes ?? [[0, 0], [0, 0]]).map(([x, y]) => {
    const [px, py] = at([x + 1.5, y + 0.5])
    return [Math.floor(px - 1.5 + 0.5), Math.floor(py - 0.5 + 0.5) - 1] as [number, number]
  }) as [[number, number], [number, number]]

  return { g: g.map(row => row.join('')), l, r, e: pose[3] ?? '' }
}

/** A sprite's colors as the drawing code reads them, and its frames for every clip. */
function drawn(theme: Form): Pick<Body, 'palette' | 'eye' | 'clips'> {
  const palette: Record<string, number> = { [SPARKLE_MARK]: SPARKLE_COLOR }
  for (const [ch, color] of Object.entries(theme.palette)) {
    palette[ch] = colorOf(color)
  }
  if (theme.cheekColor !== undefined) {
    palette[CHEEK_MARK] = colorOf(theme.cheekColor)
  }

  return {
    palette,
    eye: theme.eyes ? { ...EYE_COLOR, K: colorOf(theme.eyeColor) } : {},
    clips: {
      stand: { fps: 8, frames: STAND.map(p => poseFrame(theme, p)) },
      run: { fps: 12, frames: RUN.map(p => poseFrame(theme, p)) },
      jump: { fps: 12, frames: JUMP.map(p => poseFrame(theme, p)) },
      think: { fps: 6, frames: THINK.map(p => poseFrame(theme, p)) },
      cheer: { fps: 10, frames: CHEER.map((p, i) => poseFrame(theme, p, cheerSparkles(i))) },
    },
  }
}

/** The pet's frames for every clip and every form, with its colors as the drawing code reads them. */
export function animate(theme: Theme): Body {
  return {
    name: theme.name,
    w: BODY_W,
    h: HEIGHT,
    ...drawn(theme),
    mini: { top: colorOf(theme.mini.top), body: colorOf(theme.mini.body), edge: colorOf(theme.mini.edge) },
    miniSprite: theme.miniSprite,
    props: theme.props,
    look: { lines: theme.lines, lineColors: theme.lineColors, hud: theme.hud },
    scene: theme.scene,
    forms: Object.fromEntries(Object.entries(theme.forms).map(([mode, form]) => [mode, drawn(form)])),
  }
}

/** The resting frame as text, trimmed to the rows in use: palette characters, `@` for a pupil, `*` for a cheek. */
export function restingFrame(body: Body) {
  const frame = body.clips.stand.frames[0] as BodyFrame
  const g = frame.g.map(row => [...row])
  for (const [x, y] of Object.keys(body.eye).length > 0 ? [frame.l, frame.r] : []) {
    for (const [dx, dy] of [[0, 1], [1, 1], [0, 2], [1, 2]] as const) {
      const row = g[y + dy]
      if (row && x + dx >= 0 && x + dx < row.length) {
        row[x + dx] = PUPIL_MARK
      }
    }
  }
  const rows = g.map(r => r.join(''))

  return rows.slice(rows.findIndex(r => /[^.]/.test(r))).join('\n')
}
