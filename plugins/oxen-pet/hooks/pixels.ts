import type { Mode } from '../types'
import type { HudLook } from './hud'
import type { Scene } from './scene'

export type Clip = 'stand' | 'run' | 'jump' | 'think' | 'cheer'
export type BodyFrame = { g: string[]; l: [number, number]; r: [number, number]; e: string }
export type MiniColors = { top: number; body: number; edge: number }
/** A pet ready to draw: `animate` in theme.ts makes one from a theme. */
export type Body = {
  name: string
  w: number
  h: number
  palette: Record<string, number> // frame character -> color
  eye: Record<string, number> // expression character -> color
  mini: MiniColors
  miniSprite?: string[] // the pet's own mini, in its palette, in place of the drop
  props: Partial<Record<Mode, string[][] | null>> // the pet's own props: frames of rows in its palette; null for none
  look: Look
  scene?: Scene
  clips: Record<Clip, { fps: number; frames: BodyFrame[] }>
}
/** What a pet changes beyond its drawing: its status lines, their colors, and the HUD. */
export type Look = { lines: Partial<Record<Mode, string[]>>; lineColors: Partial<Record<Mode, string>>; hud: HudLook }
export type Canvas = { w: number; h: number; px: number[] }

const NONE = -1
const DEFAULT = 0x01000000
export const PROP_X = 17 // the prop's 16x20 box starts here; the body's right edge is empty from column 17
export const BODY_W = 19
export const PROP_W = 16
export const HEIGHT = 20
const PROP_FPS = 4 // for a pet's own props

export const EYE_COLOR: Record<string, number> = { K: 0x000000, W: 0xffffff, Y: 0xffe25a, H: 0xff78aa, B: 0x78c8ff }

export type ModeSpec = {
  clip: Clip
  fps?: number
  once?: number // ms; the mode ends by itself
  eyes: [string, number][] // expression name and how long it holds, looping
  prop?: boolean
}

export const MODES: Record<Mode, ModeSpec> = {
  idle: { clip: 'stand', eyes: [['open', 2400], ['blink', 200], ['open', 1800], ['look', 2600], ['open', 1600], ['wave', 3000], ['blink', 200], ['wink', 1800], ['content', 1800], ['open', 1800]] },
  sleep: { clip: 'stand', fps: 3, eyes: [['sleepy', 2400]] },
  think: { clip: 'think', eyes: [['look', 1800], ['curious', 2400], ['look', 1800], ['blink', 160], ['curious', 2400]] },
  read: { clip: 'stand', fps: 4, prop: true, eyes: [['scan', 2600], ['blink', 160], ['scan', 2600]] },
  search: { clip: 'stand', fps: 7, prop: true, eyes: [['wide', 1400], ['look', 1800], ['wide', 1400], ['heart', 1200]] },
  edit: { clip: 'stand', fps: 11, prop: true, eyes: [['focus', 3000], ['blink', 160], ['focus', 3000]] },
  bash: { clip: 'stand', fps: 9, prop: true, eyes: [['spiral', 3000], ['blink', 160], ['spiral', 3000]] },
  web: { clip: 'stand', fps: 6, prop: true, eyes: [['wave', 2600], ['wide', 800], ['wave', 2600]] },
  agent: { clip: 'stand', fps: 8, eyes: [['wide', 1500], ['happy', 1200], ['happy', 1200], ['wink', 1200]] },
  run: { clip: 'run', eyes: [['open', 1000]] },
  jump: { clip: 'jump', once: (14 / 12) * 1000, eyes: [['open', 1000]] },
  cheer: { clip: 'cheer', once: 1800, eyes: [['star', 900], ['happy', 900]] },
  error: { clip: 'stand', once: 2000, eyes: [['dizzy', 1000]] },
}

export function frameIndex(count: number, fps: number, elapsedMs: number, isLoop: boolean) {
  const n = Math.floor((Math.max(0, elapsedMs) / 1000) * fps)

  return isLoop ? n % count : Math.min(n, count - 1)
}

export function canvas(w: number, h: number): Canvas {
  return { w, h, px: new Array<number>(w * h).fill(NONE) }
}

function put(c: Canvas, x: number, y: number, color: number) {
  if (x >= 0 && x < c.w && y >= 0 && y < c.h) {
    c.px[y * c.w + x] = color
  }
}

function rect(c: Canvas, x: number, y: number, w: number, h: number, color: number) {
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      put(c, x + i, y + j, color)
    }
  }
}

export function stamp(c: Canvas, ox: number, oy: number, rows: string[], palette: Record<string, number>) {
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const color = palette[row[x] as string]
      if (color !== undefined) {
        put(c, ox + x, oy + y, color)
      }
    }
  })
}

export const hash = (n: number) => {
  let h = Math.imul(n | 0, 2654435761) >>> 0
  h ^= h >>> 13
  h = Math.imul(h, 1274126177) >>> 0

  return (h >>> 8) / 16777216
}

// ---- eyes: 3x3 box per eye ----

type Eyes = { l: string[]; r: string[]; fx?: (c: Canvas) => void }

const OPEN = ['...', 'KW.', 'KK.']
const BLINK = ['...', 'KKK', '...']
const same = (p: string[], fx?: Eyes['fx']): Eyes => ({ l: p, r: p, fx })

function pupil(ox: number, oy: number) {
  const g = [0, 1, 2].map(() => ['.', '.', '.'])
  const set = (x: number, y: number, ch: string) => {
    ;(g[y] as string[])[x] = ch
  }
  set(ox, oy, 'K')
  set(ox + 1, oy, 'W')
  set(ox, oy + 1, 'K')
  set(ox + 1, oy + 1, 'K')

  return g.map(r => r.join(''))
}

const RING: [number, number][] = [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2], [1, 2], [0, 2], [0, 1]]

const EXPRESSIONS: Record<string, (t: number) => Eyes> = {
  open: () => same(OPEN),
  blink: () => same(BLINK),
  wide: () => same(['KW.', 'KK.', 'KK.']),
  wave: t => {
    const g = [0, 1, 2].map(() => ['.', '.', '.'])
    for (let c = 0; c < 3; c++) {
      ;(g[1 + Math.round((Math.sin(t / 170 - c * 2.2) + 1) / 2)] as string[])[c] = 'K'
    }

    return same(g.map(r => r.join('')))
  },
  look: t => {
    const [ox, oy] = [[0, 1], [1, 1], [1, 1], [0, 1], [0, 0], [1, 0]][Math.floor(t / 500) % 6] as [number, number]

    return same(pupil(ox, oy))
  },
  scan: t => {
    const ox = [0, 0, 1, 1, 1, 0][Math.floor(t / 220) % 6] as number

    return same(pupil(ox, Math.floor(t / 1300) % 2))
  },
  wink: t => ({ l: OPEN, r: Math.floor(t / 700) % 2 ? ['...', '.K.', 'K.K'] : OPEN }),
  content: () => same(['...', 'K.K', '.K.']),
  happy: () => same(['...', '.K.', 'K.K']),
  heart: () => same(['H.H', 'HHH', '.H.']),
  star: t => same(['.Y.', `Y${Math.floor(t / 180) % 2 ? 'W' : 'Y'}Y`, '.Y.']),
  focus: () => ({ l: ['K..', '.K.', 'K..'], r: ['..K', '.K.', '..K'] }),
  curious: t => {
    const small = OPEN
    const big = ['KKK', 'KWK', 'KKK']

    return Math.floor(t / 800) % 2 ? { l: small, r: big } : { l: big, r: small }
  },
  spiral: t => {
    const g = [0, 1, 2].map(() => ['.', '.', '.'])
    const head = Math.floor(t / 90) % 8
    for (let k = 0; k < 5; k++) {
      const [x, y] = RING[(head + k) % 8] as [number, number]
      ;(g[y] as string[])[x] = 'K'
    }

    return same(g.map(r => r.join('')))
  },
  sleepy: t => {
    const q = (t / 1500) % 1

    return same(Math.floor(t / 1200) % 2 ? ['...', '...', 'KKK'] : BLINK, c => {
      if (q < 0.75) {
        stamp(c, 14, Math.round(8 - q * 7), ['XXX', '..X', '.X.', 'X..', 'XXX'], { X: 0x9fd7ff })
      }
    })
  },
  dizzy: t => same(['K.K', '.K.', 'K.K'], c => rect(c, 13, 12 + (Math.floor(t / 300) % 3), 1, 2, 0x78c8ff)),
  sweat: t => same(OPEN, c => rect(c, 13, 12 + (Math.floor(t / 500) % 2), 1, 2, 0x78c8ff)),
  tired: () => same(['...', '...', 'KKK']),
}

/** Every face the pet can make, from any sprite. */
export const FACES = Object.keys(EXPRESSIONS)

/** What low HP or MP does to the face while the pet has no tool in hand. */
const MOOD_EYES: Record<string, string> = { worried: 'sweat', critical: 'dizzy', tired: 'tired' }

const RUN_EYES: Record<string, string> = { open: 'open', wide: 'wide', bar: 'blink' }

export function expressionName(mode: Mode, elapsedMs: number, hint: string, mood = 'ok') {
  const spec = MODES[mode]
  if ((mode === 'idle' || mode === 'think') && MOOD_EYES[mood]) {
    return MOOD_EYES[mood] as string
  }
  if (mode === 'run' || mode === 'jump') {
    return RUN_EYES[hint] ?? 'open'
  }
  const total = spec.eyes.reduce((sum, [, ms]) => sum + ms, 0)
  let u = Math.max(0, elapsedMs) % total
  for (const [name, ms] of spec.eyes) {
    if (u < ms) {
      return name
    }
    u -= ms
  }

  return 'open'
}

// ---- props: each is drawn in a 16x20 box ----

const hex = (s: string) => parseInt(s.slice(1), 16)

const PROPS: Partial<Record<Mode, (c: Canvas, t: number) => void>> = {
  read: (c, t) => {
    const row = Math.floor(t / 300) % 3
    rect(c, 0, 8, 16, 10, hex('#6b3f17'))
    rect(c, 1, 9, 6, 8, hex('#f1e8c8'))
    rect(c, 9, 9, 6, 8, hex('#f1e8c8'))
    rect(c, 7, 9, 2, 8, hex('#a98b55'))
    for (const y of [10, 12, 14]) {
      rect(c, 2, y, 4, 1, hex('#b9ad8a'))
      rect(c, 10, y, 4, 1, hex('#b9ad8a'))
    }
    rect(c, 10, 10 + row * 2, 4, 1, hex('#4cae3b'))
    if (t % 2400 > 2100) {
      rect(c, 9, 9, 6, 8, hex('#e4d9b4'))
      rect(c, 5, 6, 5, 8, hex('#f7f0d8'))
      rect(c, 5, 13, 5, 1, hex('#cbbd90'))
    }
  },
  search: (c, t) => {
    rect(c, 1, 4, 10, 14, hex('#e9ecf2'))
    rect(c, 1, 4, 10, 1, hex('#c4c9d4'))
    for (let y = 7; y <= 15; y += 2) {
      rect(c, 3, y, 6, 1, hex('#8b93a1'))
    }
    const cx = Math.round(5 + 4 * Math.sin(t / 600))
    const cy = Math.round(10 + 3 * Math.sin(t / 900 + 1))
    const ring = hex('#9fd7ff')
    rect(c, cx - 1, cy - 1, 3, 3, hex('#c1dcf6'))
    rect(c, cx - 1, cy - 2, 3, 1, ring)
    rect(c, cx - 1, cy + 2, 3, 1, ring)
    rect(c, cx - 2, cy - 1, 1, 3, ring)
    rect(c, cx + 2, cy - 1, 1, 3, ring)
    for (const [dx, dy] of [[3, 3], [4, 4], [3, 2], [2, 3]] as const) {
      put(c, cx + dx, cy + dy, hex('#7a4a1e'))
    }
    if (t % 2800 > 2400) {
      rect(c, 13, 2, 1, 3, hex('#ffe25a'))
      put(c, 13, 6, hex('#ffe25a'))
    }
  },
  edit: (c, t) => {
    const widths = [6, 4, 7, 5, 6, 3]
    const indents = [2, 4, 4, 4, 2, 4]
    const colors = ['#6ad23a', '#9fd7ff', '#ffe25a', '#9fd7ff', '#6ad23a', '#ffe25a'].map(hex)
    const line = Math.floor(t / 900) % 7
    const done = (t % 900) / 900
    rect(c, 0, 3, 13, 15, hex('#f4f4f4'))
    rect(c, 0, 3, 13, 1, hex('#c4c9d4'))
    let tx = 2
    let ty = 5
    for (let i = 0; i < 6; i++) {
      const y = 5 + i * 2
      const indent = indents[i] as number
      const color = colors[i] as number
      if (i < line) {
        rect(c, 1 + indent, y, widths[i] as number, 1, color)
      } else if (i === line) {
        const w = Math.max(1, Math.round((widths[i] as number) * done))
        rect(c, 1 + indent, y, w, 1, color)
        tx = 1 + indent + w
        ty = y
      }
    }
    put(c, tx, ty + 1, hex('#2b2b2b'))
    for (let k = 0; k < 3; k++) {
      put(c, tx + 1 + k, ty - k, hex('#ffd23f'))
    }
    put(c, tx + 4, ty - 3, hex('#f56060'))
  },
  bash: (c, t) => {
    rect(c, 0, 4, 16, 14, hex('#3a404c'))
    rect(c, 1, 7, 14, 10, hex('#0b0d10'))
    rect(c, 1, 5, 14, 2, hex('#2a2f3a'))
    put(c, 2, 5, hex('#f56060'))
    put(c, 4, 5, hex('#ffe25a'))
    put(c, 6, 5, hex('#4cae3b'))
    const n = Math.floor(t / 420)
    for (let k = 0; k < 5; k++) {
      const li = n - 4 + k
      const y = 8 + k * 2
      if (li < 0) {
        continue
      }
      if (li % 5 === 0) {
        put(c, 2, y, hex('#4cae3b'))
        rect(c, 4, y, Math.min(8, 3 + Math.floor(hash(li) * 6)), 1, hex('#e6e8ec'))
      } else {
        rect(c, 2, y, 2 + Math.floor(hash(li) * 10), 1, li % 7 === 3 ? hex('#f56060') : hex('#7d8696'))
      }
    }
    if (Math.floor(t / 250) % 2 === 0) {
      rect(c, 2, 16, 2, 1, hex('#e6e8ec'))
    }
  },
  web: (c, t) => {
    const off = t / 250
    for (let y = 4; y <= 17; y++) {
      for (let x = 1; x <= 14; x++) {
        const d = Math.hypot(x + 0.5 - 8, y + 0.5 - 11)
        if (d > 6.6) {
          continue
        }
        let color = d > 5.6 ? '#1b4f8f' : '#2e7fd9'
        if (d <= 5.6 && Math.sin((x + off) * 0.9) + Math.cos(y * 0.8 + (x + off) * 0.3) > 0.9) {
          color = '#4cae3b'
        }
        put(c, x, y, hex(color))
      }
    }
    const a = t / 500
    rect(c, Math.round(7 + 7 * Math.cos(a)), Math.round(10 + 3 * Math.sin(a)), 2, 2, hex(Math.sin(a) > 0 ? '#ffe25a' : '#a98b2f'))
  },
}

// ---- minis: one per running subagent, in a trail behind the pet ----

/** One mini as drawn: ms since its agent started, and since it ended once it has. */
export type MiniView = { age: number; doneFor?: number; failed?: boolean }

export const MAX_MINIS = 6
const MINI_W = 6 // a 5 px mini and a 1 px gap
export const MINI_SIZE = { w: 5, h: 7 }
const MINI_DROP_MS = 300

export const trailWidth = (count: number) => Math.min(count, MAX_MINIS) * MINI_W

const MINI_FAILED = { top: hex('#b4b4b4'), body: hex('#8b93a1'), edge: hex('#5a606b') }

const grey = (c: number) => {
  const l = Math.round(0.3 * ((c >> 16) & 255) + 0.59 * ((c >> 8) & 255) + 0.11 * (c & 255))
  return (l << 16) | (l << 8) | l
}

function drawMini(c: Canvas, ox: number, m: MiniView, k: number, body: Body) {
  let lift = Math.round(Math.abs(Math.sin(m.age / 260 + k * 1.3)) * 3)
  if (m.age < MINI_DROP_MS) {
    lift = Math.round((1 - m.age / MINI_DROP_MS) * 10)
  } else if (m.doneFor !== undefined && !m.failed) {
    lift = Math.round(Math.abs(Math.sin(m.doneFor / 160)) * 5)
  }
  const rows = body.miniSprite
  const y = HEIGHT - (rows?.length ?? 5) - lift
  if (rows) {
    const palette = m.failed ? Object.fromEntries(Object.entries(body.palette).map(([ch, color]) => [ch, grey(color)])) : body.palette
    stamp(c, ox, y, rows, palette)
  } else {
    drawDrop(c, ox, y, m.failed ? MINI_FAILED : body.mini)
  }
  if (m.doneFor !== undefined && !m.failed && Math.floor(m.doneFor / 180) % 2 === 0) {
    put(c, ox + 2, y - 2, EYE_COLOR.Y as number)
  }
}

function drawDrop(c: Canvas, ox: number, y: number, colors: MiniColors) {
  put(c, ox + 2, y, colors.top)
  rect(c, ox + 1, y + 1, 3, 1, colors.top)
  rect(c, ox, y + 2, 5, 2, colors.body)
  put(c, ox + 1, y + 2, 0)
  put(c, ox + 3, y + 2, 0)
  rect(c, ox + 1, y + 4, 3, 1, colors.edge)
}

export function overlay(out: Canvas, src: Canvas, ox: number) {
  for (let y = 0; y < src.h; y++) {
    for (let x = 0; x < src.w; x++) {
      const color = src.px[y * src.w + x] as number
      if (color !== NONE) {
        put(out, ox + x, y, color)
      }
    }
  }
}

function mirror(c: Canvas) {
  for (let y = 0; y < c.h; y++) {
    const row = c.px.slice(y * c.w, (y + 1) * c.w).reverse()
    c.px.splice(y * c.w, c.w, ...row)
  }
}

// ---- effects on the body canvas ----

const QUESTION = ['YYY', '..Y', '.Y.', '...', '.Y.']
const DUST = hex('#8b93a1')
const THOUGHT = hex('#c8c8c8')

function effects(c: Canvas, mode: Mode, clipIndex: number, t: number, ownThink: boolean) {
  if (mode === 'think' && !ownThink) {
    stamp(c, 14, 2 + (Math.floor(t / 400) % 2), QUESTION, EYE_COLOR)
    for (let k = 0; k < 1 + (Math.floor(t / 500) % 3); k++) {
      put(c, 13 + k * 2, 9, THOUGHT)
    }
  }
  const lands = (mode === 'run' && (clipIndex === 0 || clipIndex === 6)) || (mode === 'jump' && (clipIndex === 11 || clipIndex === 12))
  if (lands) {
    rect(c, 0, 19, 1, 1, DUST)
    put(c, 1, 18, DUST)
    rect(c, 18, 19, 1, 1, DUST)
    put(c, 17, 18, DUST)
  }
}

/** How the prop of `mode` draws: the pet's own, the mod's, or none. */
function propOf(body: Body, mode: Mode): ((c: Canvas, t: number) => void) | undefined {
  const own = body.props[mode]
  if (own === null) {
    return undefined
  }
  if (own) {
    return (c, t) => {
      const rows = own[frameIndex(own.length, PROP_FPS, t, true)] as string[]
      stamp(c, 0, HEIGHT - rows.length, rows, body.palette)
    }
  }

  return MODES[mode].prop ? PROPS[mode] : undefined
}

// ---- compose ----

export function compose(body: Body, mode: Mode, elapsedMs: number, dir: 1 | -1, mood = 'ok', minis: MiniView[] = []): Canvas {
  // The expressions index their sequences by time; a negative time would index past the start.
  elapsedMs = Math.max(0, elapsedMs)
  const spec = MODES[mode]
  const clip = body.clips[spec.clip]
  const isLoop = spec.once === undefined
  const index = frameIndex(clip.frames.length, spec.fps ?? clip.fps, elapsedMs, isLoop)
  const frame = clip.frames[index] as BodyFrame
  const pet = canvas(BODY_W, HEIGHT)

  stamp(pet, 0, 0, frame.g, body.palette)

  const eyes = (EXPRESSIONS[expressionName(mode, elapsedMs, frame.e, mood)] as (t: number) => Eyes)(elapsedMs)
  const shift = mode === 'run' ? 1 : 0
  stamp(pet, frame.l[0] + shift, frame.l[1], eyes.l, body.eye)
  stamp(pet, frame.r[0] + shift, frame.r[1], eyes.r, body.eye)
  eyes.fx?.(pet)
  // A pet's own think prop, or none, takes the place of the question mark.
  effects(pet, mode, index, elapsedMs, body.props.think !== undefined)

  const drawProp = mode === 'run' ? undefined : propOf(body, mode)
  const trail = trailWidth(minis.length)
  const out = canvas(trail + (drawProp ? PROP_X + PROP_W : BODY_W), HEIGHT)
  minis.slice(0, MAX_MINIS).forEach((m, k) => drawMini(out, trail - (k + 1) * MINI_W, m, k, body))
  overlay(out, pet, trail)
  if (drawProp) {
    const prop = canvas(PROP_W, HEIGHT)
    drawProp(prop, elapsedMs)
    overlay(out, prop, trail + PROP_X)
  }
  // Running or jumping left mirrors the whole picture, so the trail stays behind the pet. Neither mode has a prop.
  if ((mode === 'run' || mode === 'jump') && dir === -1) {
    mirror(out)
  }

  return out
}

/** The pet resting with one face, by name from FACES, at `t` ms into the face's own motion. */
export function composeFace(body: Body, name: string, t: number): Canvas {
  const frame = body.clips.stand.frames[0] as BodyFrame
  const c = canvas(BODY_W, HEIGHT)
  stamp(c, 0, 0, frame.g, body.palette)
  const expression = EXPRESSIONS[name] ?? (EXPRESSIONS.open as (t: number) => Eyes)
  const eyes = expression(Math.max(0, t))
  stamp(c, frame.l[0], frame.l[1], eyes.l, body.eye)
  stamp(c, frame.r[0], frame.r[1], eyes.r, body.eye)
  eyes.fx?.(c)

  return c
}

// ---- encoders ----

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function base64(bytes: number[]) {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const n = ((bytes[i] as number) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    out += B64.charAt((n >> 18) & 63) + B64.charAt((n >> 12) & 63)
    out += i + 1 < bytes.length ? B64.charAt((n >> 6) & 63) : '='
    out += i + 2 < bytes.length ? B64.charAt(n & 63) : '='
  }

  return out
}

/** The `w`×`h` part of `c` from column `x`, row `y`. */
export function crop(c: Canvas, x: number, y: number, w: number, h: number): Canvas {
  const out = canvas(w, h)
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      out.px[j * w + i] = c.px[(y + j) * c.w + x + i] as number
    }
  }

  return out
}

/** Raster `cells`: little-endian u32 triplets [glyph, fg, bg], two pixels per cell as ▀ and ▄. */
export function encodeCells(c: Canvas) {
  const bytes: number[] = []
  const word = (v: number) => bytes.push(v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255)
  for (let r = 0; r < c.h / 2; r++) {
    for (let x = 0; x < c.w; x++) {
      const top = c.px[2 * r * c.w + x] as number
      const bottom = c.px[(2 * r + 1) * c.w + x] as number
      if (top === NONE && bottom === NONE) {
        word(0x20)
        word(DEFAULT)
        word(DEFAULT)
      } else if (bottom === NONE) {
        word(0x2580)
        word(top)
        word(DEFAULT)
      } else if (top === NONE) {
        word(0x2584)
        word(bottom)
        word(DEFAULT)
      } else {
        word(0x2580)
        word(top)
        word(bottom)
      }
    }
  }

  return base64(bytes)
}

export function encodeSvg(c: Canvas) {
  const paths = new Map<number, string[]>()
  for (let y = 0; y < c.h; y++) {
    let x = 0
    while (x < c.w) {
      const color = c.px[y * c.w + x] as number
      let n = 1
      while (x + n < c.w && c.px[y * c.w + x + n] === color) {
        n += 1
      }
      if (color !== NONE) {
        paths.set(color, [...(paths.get(color) ?? []), `M${x} ${y}h${n}v1h-${n}z`])
      }
      x += n
    }
  }
  const body = [...paths].map(([color, d]) => `<path fill="#${color.toString(16).padStart(6, '0')}" d="${d.join('')}"/>`).join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${c.w} ${c.h}" shape-rendering="crispEdges">${body}</svg>`
}
