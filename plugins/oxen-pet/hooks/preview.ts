import type { Anim, Mode } from '../types'
import { TICK_MS, leapClipMs, step } from './anim'
import { HUD_WINDOW_W, frameColor, hudRows, windowEdges } from './hud'
import type { Hud } from './hud'
import { BOSS_W, DEFEAT_MS, drawBoss } from './boss'
import { BODY_W, FACES, HEIGHT, MODES, canvas, compose, composeFace, overlay } from './pixels'
import type { Body, Canvas, Clip } from './pixels'
import { GROUND_H, drawBand, layScene, obstacleSpans } from './scene'
import { LINES, lineColor } from './status'

// When each mode plays, in the words of the README's table.
const WHEN: Record<Mode, string> = {
  idle: 'Claude is idle',
  sleep: 'Idle for a while',
  jump: 'A turn starts',
  think: 'Claude thinks longer',
  read: 'Read',
  search: 'Grep, Glob',
  edit: 'Edit, MultiEdit, Write, NotebookEdit, TodoWrite',
  bash: 'Bash, and any tool not listed',
  web: 'WebFetch, WebSearch',
  run: 'A tool call ends',
  agent: 'A subagent starts',
  error: 'A tool call fails',
  cheer: 'A turn ends',
  guard: 'A destructive command waits for your answer',
}
// What the status line names in each mode, for the lines that name something.
const SAMPLE_TARGET: Partial<Record<Mode, string>> = { read: 'app.ts', search: 'useState', edit: 'app.ts', bash: 'npm test', web: 'docs.anthropic.com', guard: 'rm -rf build' }
const SAMPLE_HUDS: [string, Hud][] = [
  ['Early in a session', { hp: 86, cacheMin: 52, mp: 72, mpResetsInMin: 213, st: 64, stResetsInMin: 4560 }],
  ['Running low', { hp: 18, cacheMin: 0, mp: 12, mpResetsInMin: 41, st: 9, stResetsInMin: 1500 }],
  ['Burning fast', { hp: 70, cacheMin: 4, mp: 40, mpResetsInMin: 180, st: 20, stResetsInMin: 5040 }],
]
const BOSS_GAP = 12 // columns between the pet and the boss in the boss tile
const BOSS_BEATEN_AT = 2600
const MOTION_FPS = 10
const SCENE_W = 96 // columns of the sample band
const SCENE_MS = 12000
const FACE_FPS = 5
const LOOP_MS = 2400

// One character per palette entry; the set leaves out what would need escaping in HTML or a JS string.
const CODES = [...Array.from({ length: 94 }, (_, i) => String.fromCharCode(33 + i)).filter(c => !`"'\\<>&\``.includes(c)), ...Array.from({ length: 200 }, (_, i) => String.fromCharCode(192 + i))]

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)

type Tile = { label: string; note: string; w: number; h: number; fps: number; frames: string[] }

/**
 * The preview: a self-contained HTML page with every motion, face, and frame the mod makes for `body`. It shows each mode in
 * motion with when it plays, the pet running through its scene when it has one, the boss fight, each face, each mode's status lines,
 * the HUD in two sample states, and each clip's frames before eyes go on. A button switches to a light
 * terminal's background. `notes` are readTheme's.
 */
export function previewPage(body: Body, notes: string[]): string {
  const colors: number[] = []
  const encode = (c: Canvas) =>
    c.px
      .map(color => {
        if (color === -1) {
          return ' '
        }
        let i = colors.indexOf(color)
        if (i === -1) {
          i = colors.push(color) - 1
        }
        return CODES[i] ?? ' '
      })
      .join('')
  const frames = (count: number, fps: number, draw: (t: number) => Canvas) => Array.from({ length: count }, (_, i) => draw((i * 1000) / fps))

  const motions: Tile[] = (Object.keys(WHEN) as Mode[]).map(mode => {
    const length = MODES[mode].once ?? LOOP_MS
    const minis = mode === 'agent' ? [{ age: 1000 }, { age: 400 }] : []
    const shots = frames(Math.ceil((length / 1000) * MOTION_FPS), MOTION_FPS, t => compose(body, mode, t, 1, 'ok', minis.map(m => ({ age: m.age + t }))))
    const first = shots[0] as Canvas
    return { label: mode, note: WHEN[mode], w: first.w, h: first.h, fps: MOTION_FPS, frames: shots.map(encode) }
  })
  const faces: Tile[] = FACES.map(name => {
    const shots = frames((LOOP_MS / 1000) * FACE_FPS, FACE_FPS, t => composeFace(body, name, t))
    const first = shots[0] as Canvas
    return { label: name, note: '', w: first.w, h: first.h, fps: FACE_FPS, frames: shots.map(encode) }
  })
  const clips: Tile[] = (Object.keys(body.clips) as Clip[]).map(clip => {
    const { fps, frames: list } = body.clips[clip]
    const shots = list.map(f => {
      const c: Canvas = { w: BODY_W, h: HEIGHT, px: [] }
      for (const row of f.g) {
        for (const ch of row) {
          c.px.push(body.palette[ch] ?? -1)
        }
      }
      return c
    })
    return { label: clip, note: `${list.length} frames at ${fps} fps`, w: BODY_W, h: HEIGHT, fps, frames: shots.map(encode) }
  })
  const scenes: Tile[] = []
  if (body.scene) {
    const layout = layScene(body.scene, SCENE_W)
    const between = { isWorking: true, activeTools: 0, activeMode: 'bash' as const, activeTarget: '', lastToolAt: Infinity, room: SCENE_W - BODY_W, obstacles: obstacleSpans(layout), trail: 0 }
    let a: Anim = { mode: 'run', since: 0, x: 0, dir: 1, tick: 0, target: '', working: true }
    const shots: string[] = []
    for (let t = 0; t < SCENE_MS; t += TICK_MS) {
      a = step(a, between, t)
      const picture = a.leap ? compose(body, 'jump', leapClipMs(t - a.leap.since), a.dir) : compose(body, 'run', t - a.since, a.dir)
      shots.push(encode(drawBand(body, body.scene, layout, picture, Math.round(a.x), t)))
    }
    scenes.push({ label: 'run', note: 'Between tool calls, leaping each obstacle on the way', w: SCENE_W, h: HEIGHT + GROUND_H, fps: 1000 / TICK_MS, frames: shots })
  }
  // A test run fails and brings the boss; the next run passes and defeats it, and the pet cheers.
  const bossShots: string[] = []
  const BOSS_FIGHT_W = BODY_W + BOSS_GAP + BOSS_W
  for (let t = 0; t < BOSS_BEATEN_AT + DEFEAT_MS; t += TICK_MS) {
    const isBeaten = t >= BOSS_BEATEN_AT
    const c = canvas(BOSS_FIGHT_W, HEIGHT)
    overlay(c, isBeaten ? compose(body, 'cheer', t - BOSS_BEATEN_AT, 1) : compose(body, t < MODES.error.once! ? 'error' : 'idle', t, 1), 0)
    overlay(c, drawBoss(isBeaten ? { since: 0, hits: 2, defeatedAt: BOSS_BEATEN_AT } : { since: 0, hits: t < 1200 ? 1 : 2 }, t), BODY_W + BOSS_GAP)
    bossShots.push(encode(c))
  }
  const bossFight: Tile[] = [{ label: 'boss', note: 'Failed test runs bring a bug; the next passing run defeats it', w: BOSS_FIGHT_W, h: HEIGHT, fps: 1000 / TICK_MS, frames: bossShots }]
  const palette = colors.map(c => `#${c.toString(16).padStart(6, '0')}`)
  const name = escapeHtml(body.name)
  const tiles = (list: Tile[], kind: string) =>
    list.map((t, i) => `<figure><canvas data-kind="${kind}" data-i="${i}" width="${t.w * 4}" height="${t.h * 4}"></canvas><figcaption><b>${t.label}</b>${t.note ? `<span>${escapeHtml(t.note)}</span>` : ''}</figcaption></figure>`).join('')
  const statusLines = (Object.keys(WHEN) as Mode[])
    .map(mode => {
      const lines = (body.look.lines[mode] ?? LINES[mode]).map(l => `<li>› ${escapeHtml(l.replace('{}', SAMPLE_TARGET[mode] ?? 'something'))}</li>`).join('')
      return `<div class="lines"><b>${mode}</b><ul style="color: ${lineColor(mode, body.look.lineColors)}">${lines}</ul></div>`
    })
    .join('')
  const edges = windowEdges(HUD_WINDOW_W)
  const huds = SAMPLE_HUDS.map(([label, h]) => {
    const rows = hudRows(h, body.look.hud)
    const inside = rows.length === 0
      ? '<p>The pet hides every bar, so the HUD does not show.</p>'
      : `<pre class="hud" style="color: ${frameColor(body.look.hud)}">${escapeHtml(edges.top)}\n${rows
          .map(r => `${edges.side} <span style="color: ${r.color}">${escapeHtml(r.label)} </span><canvas class="bar" data-cells="${r.cells}"></canvas>${r.parts.map(p => `<span style="color: ${p.color}${p.bold ? '; font-weight: bold' : ''}">${escapeHtml(p.text)}</span>`).join('')}`)
          .join('\n')}\n${escapeHtml(edges.bottom)}</pre>`
    return `<figure class="wide"><figcaption><b>${label}</b></figcaption>${inside}</figure>`
  }).join('')
  const noteList = notes.length > 0 ? `<section class="notes"><h2>Notes</h2><ul>${notes.map(n => `<li>${escapeHtml(n)}</li>`).join('')}</ul></section>` : ''

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${name}: preview</title>
<style>
  body { margin: 0; padding: 32px; font: 15px/1.5 ui-monospace, Menlo, monospace; background: #0b0f2a; color: #e3e8ff; }
  body.light { background: #f4f5f9; color: #1b1e2b; }
  header { display: flex; flex-wrap: wrap; gap: 16px; align-items: baseline; justify-content: space-between; max-width: 1100px; }
  h1 { margin: 0; font-size: 28px; }
  h2 { font-size: 18px; margin: 32px 0 12px; }
  p { margin: 4px 0 0; opacity: 0.8; }
  button { font: inherit; padding: 8px 14px; border: 2px solid currentColor; background: transparent; color: inherit; cursor: pointer; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 16px; max-width: 1100px; }
  figure { margin: 0; padding: 12px; border: 2px solid #2a3470; display: grid; gap: 8px; justify-items: center; }
  body.light figure { border-color: #c9cede; }
  canvas { image-rendering: pixelated; max-width: 100%; }
  figcaption { display: grid; text-align: center; }
  figcaption span { font-size: 12px; opacity: 0.7; }
  .notes { max-width: 1100px; border: 2px solid #e0b400; padding: 0 16px 8px; }
  .wide-cells { grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
  .stack { display: grid; gap: 16px; max-width: 1100px; }
  .wide { justify-items: start; overflow-x: auto; }
  .wide canvas[data-kind] { width: 100%; height: auto; }
  .lines ul { margin: 4px 0 0; padding: 0; list-style: none; font-weight: bold; }
  .hud { margin: 0; line-height: 18px; }
  .hud canvas.bar { width: 180px; height: 18px; vertical-align: top; }
</style>
</head>
<body>
<header>
  <div><h1>${name}</h1><p>Every motion, face, status line, and HUD look of this pet${scenes.length > 0 ? ', and its scene' : ''}. Approve it in Claude Code, or say what to change.</p></div>
  <button type="button" aria-pressed="false" id="light">Light terminal</button>
</header>
${noteList}
<h2>Motions</h2>
<div class="grid">${tiles(motions, 'motion')}</div>
${scenes.length > 0 ? `<h2>Scene</h2>\n<div class="stack">${tiles(scenes, 'scene').replace('<figure>', '<figure class="wide">')}</div>` : ''}
<h2>Boss</h2>
<div class="grid">${tiles(bossFight, 'boss')}</div>
<h2>Faces</h2>
<div class="grid">${tiles(faces, 'face')}</div>
<h2>Status lines</h2>
<p>The line beside the pet in each mode. One shows at a time, and the next takes over every 4 seconds.</p>
<div class="grid wide-cells">${statusLines}</div>
<h2>HUD</h2>
<div class="stack">${huds}</div>
<h2>Frames</h2>
<p>Each clip as the mod squashes and stretches the sprite, before eyes and props go on.</p>
<div class="grid">${tiles(clips, 'clip')}</div>
<script>
const PALETTE = ${JSON.stringify(palette)}
const CODES = ${JSON.stringify(CODES.slice(0, palette.length).join(''))}
const TILES = { motion: ${JSON.stringify(motions)}, scene: ${JSON.stringify(scenes)}, boss: ${JSON.stringify(bossFight)}, face: ${JSON.stringify(faces)}, clip: ${JSON.stringify(clips)} }
const still = matchMedia('(prefers-reduced-motion: reduce)').matches
const canvases = [...document.querySelectorAll('canvas[data-kind]')].map(c => ({ ctx: c.getContext('2d'), tile: TILES[c.dataset.kind][c.dataset.i] }))
function draw(ctx, tile, frame) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  for (let i = 0; i < frame.length; i++) {
    const k = CODES.indexOf(frame[i])
    if (k < 0) continue
    ctx.fillStyle = PALETTE[k]
    ctx.fillRect((i % tile.w) * 4, Math.floor(i / tile.w) * 4, 4, 4)
  }
}
function loop(now) {
  for (const { ctx, tile } of canvases) draw(ctx, tile, tile.frames[still ? 0 : Math.floor((now / 1000) * tile.fps) % tile.frames.length])
  if (!still) requestAnimationFrame(loop)
}
requestAnimationFrame(loop)
// A bar's cells as the terminal draws them: little-endian u32 triplets [glyph, fg, bg], ▀ or ▄, 2 pixels per cell.
for (const bar of document.querySelectorAll('canvas.bar')) {
  const b = atob(bar.dataset.cells)
  const u32 = k => (b.charCodeAt(k) | (b.charCodeAt(k + 1) << 8) | (b.charCodeAt(k + 2) << 16) | (b.charCodeAt(k + 3) << 24)) >>> 0
  const cells = b.length / 12
  bar.width = cells * 9
  bar.height = 18
  const ctx = bar.getContext('2d')
  for (let i = 0; i < cells; i++) {
    const [glyph, fg, bg] = [u32(i * 12), u32(i * 12 + 4), u32(i * 12 + 8)]
    const half = (color, y) => { if (color < 0x1000000) { ctx.fillStyle = '#' + color.toString(16).padStart(6, '0'); ctx.fillRect(i * 9, y, 9, 9) } }
    if (glyph === 0x2580) { half(fg, 0); half(bg, 9) }
    if (glyph === 0x2584) half(fg, 9)
  }
}
const light = document.getElementById('light')
light.onclick = () => light.setAttribute('aria-pressed', String(document.body.classList.toggle('light')))
</script>
</body>
</html>
`
}
