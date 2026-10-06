// Records docs/images/meter-demo.gif: oxen-meter through a scripted session in Claude Code, a Codex CLI and a Devin
// CLI prompt, and the companion's report. Every line the meter shows comes from its own modules, given the session's
// records: the pane's rows (paneRows), the cold resume question (resumeRisk, resumeQuestion), the Codex and Devin
// hooks' answers (idleRisk, promptAnswer), and the report (summarize, reportText). The tools' screens around them follow
// captures of Claude Code 2.1.291, Codex CLI 0.160.1 and Devin CLI 3000.11.3. Also writes meter-pane.png and
// meter-report.png beside the GIF: the pane, and the report.
// Run: node tools/demo/meter.mjs [out.gif] (Node 22.18 or later). Needs Google Chrome, or its path in CHROME, and
// ffmpeg on the PATH. `--text` prints the key frames as text instead, with neither.
//
// A developer tool, never shipped, like record.mjs: it lives outside the plugins and tools/meter, starts processes
// (Chrome, ffmpeg) and opens a socket (Chrome's DevTools on 127.0.0.1). See SECURITY-AUDIT.md.
import { spawn, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// The hooks import each other without an extension, as the mod's bundler allows.
registerHooks({ resolve: (spec, ctx, next) => next(/^\.\.?\//.test(spec) && !/\.[a-z]+$/.test(spec) ? `${spec}.ts` : spec, ctx) })
const meter = new URL('../../plugins/oxen-meter/', import.meta.url)
const hook = name => import(new URL(`hooks/${name}.ts`, meter).href)
const { MAIN, addCompaction, addEvent, addStep, gapOf, newCollector } = await hook('record')
const { summarize } = await hook('analyze')
const { COLORS, filesText, paneRows, reportText } = await hook('report')
const { RESUME_OPTIONS, resumeQuestion, resumeRisk } = await hook('resume')
const { idleRisk, promptAnswer } = await hook('hookGuard')
const { readSettings } = await hook('settings')
const { noteTiming } = await hook('timing')
const { importLine } = await import(new URL('../meter/lib/cli.mjs', import.meta.url).href)

const args = process.argv.slice(2)
const asText = args.includes('--text')
const out = args.find(a => !a.startsWith('--')) ?? fileURLToPath(new URL('../../docs/images/meter-demo.gif', import.meta.url))
const paneOut = join(dirname(out), 'meter-pane.png')
const reportOut = join(dirname(out), 'meter-report.png')
const chromePath = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
if (!asText && !existsSync(chromePath)) {
  console.error(`No Chrome at ${chromePath}. Set CHROME to its path.`)
  process.exit(1)
}

// ---- the screen ----

const COLS = 100
const ROWS = 27
const FRAME_MS = 100
const TEXT = '#e3e6f0'
const GREY = '#8b93b8'
const DIM = '#6b7499'
const RULE = '#4b5068'
const GREEN = '#2fbf5b'
const ACCENT = '#b1b9f9'
const BASE = Date.UTC(2026, 9, 6, 10, 0, 0) // 10:00 on the session's clock
const DATA = '/Users/you/.claude/oxen-meter'
const S = readSettings({ resumeGuard: 'ask' })

const len = s => [...s].length

/** `text` in lines of at most `width`, broken between words. */
function wrap(text, width) {
  const lines = []
  let line = ''
  for (const word of text.split(' ')) {
    if (line !== '' && len(line) + 1 + len(word) > width) {
      lines.push(line)
      line = word
    } else {
      line = line === '' ? word : `${line} ${word}`
    }
  }
  return [...lines, line]
}

/** One screen line as text ops: spans laid end to end from `col`. */
function spansOps(row, col, spans) {
  return spans.map(s => {
    const op = { row, col, text: s.text, color: s.color ?? TEXT, ...(s.bold ? { bold: true } : {}) }
    col += len(s.text)
    return op
  })
}

/** A line of transcript, wrapped as the terminal wraps it, under `indent` spaces after the first. */
function wrapSpans(spans, width, indent) {
  const plain = spans.map(s => s.text).join('')
  if (len(plain) <= width) {
    return [spans]
  }
  const lead = plain.match(/^ */)[0]
  const [first, ...rest] = wrap(plain.slice(lead.length), width - lead.length)
  const head = []
  let left = lead.length + len(first)
  for (const s of spans) {
    if (left <= 0) break
    const part = [...s.text].slice(0, left).join('')
    head.push({ ...s, text: part })
    left -= len(part)
  }
  const tail = spans.at(-1)
  return [head, ...wrap(rest.join(' '), width - indent).map(l => [{ ...tail, text: `${' '.repeat(indent)}${l}` }])]
}

const typed = (text, t, from, to) => (t < from ? '' : [...text].slice(0, Math.round(len(text) * Math.min(1, (t - from) / (to - from)))).join(''))
const clock = epoch => new Date(epoch).toISOString().slice(11, 16)

// ---- scene 1: Claude Code, the pane and the cold resume guard ----

/** A thread's steps as a tool reports them: each reads the context before it back (warm) or sends it again (cold). */
function threadOf(c, { thread = MAIN, agentType, model, writes = true, timings = false }) {
  let ctx = 0
  let msgs = 0
  let n = 0
  return {
    step(t0, t1, { grow = 1500, out = 300, tools = [], cold = false, keepalive = false } = {}) {
      const prev = ctx
      const read = cold || prev === 0 ? 0 : prev
      const fresh = (keepalive ? prev : prev + grow) - read
      const u = keepalive ? { in: 8, cr: prev, cw: 0, out: 1 } : writes ? { in: Math.min(12, fresh), cr: read, cw: Math.max(0, fresh - 12), out } : { in: fresh, cr: read, cw: 0, out }
      ctx = u.in + u.cr + u.cw
      msgs += keepalive ? 0 : 2
      n += 1
      const gapMs = gapOf(c, thread, t0)
      addStep(c, { k: 'step', t0, t1, turn: `t${n}`, idx: 0, thread, ...(agentType ? { agentType } : {}), model, ...u, ctx, ...(gapMs !== undefined ? { gapMs } : {}), msgs, tools, ...(keepalive ? { keepalive: true } : {}) })
      if (timings) {
        noteTiming(c.timings, 'turn.step', [0.06, 0.09, 0.07, 0.12, 0.08, 0.21][n % 6])
      }
    },
  }
}

const AG1 = 'a1c94e07d2b5c3f2a' // its label ends in 3f2a
const AG2 = 'a5e8d17c90b4a9b1c'
const LABEL1 = 'general-purpose 3f2a'
const PROMPT1 = 'refactor the payment module, and get a Codex audit of it'
const PROMPT2 = 'tell the agent to check refunds too'
const DIALOG = [16300, 21000] // ms: the cold resume question is up between these
const SCENE1_MS = 27000

// The session's clock against the recording's: ten times as fast while Claude works, then six minutes go by in six
// seconds while the subagent waits for Codex, then about three times as fast.
const SIM = [[0, 0], [8000, 80], [10000, 280], [13000, 380], [14000, 480], [SCENE1_MS, 520]]
function simAt(t) {
  const found = SIM.findIndex((_, k) => k + 1 < SIM.length && t < SIM[k + 1][0])
  const i = found < 0 ? SIM.length - 2 : found
  const [[r0, s0], [r1, s1]] = [SIM[i], SIM[i + 1] ?? SIM[i]]
  return BASE + Math.round((s0 + ((s1 - s0) * (Math.min(t, r1) - r0)) / Math.max(1, r1 - r0)) * 1000)
}

/** Scene 1's events in recording time, each applied once its time comes: steps, events, transcript lines. */
function scene1() {
  const c = newCollector()
  const main = threadOf(c, { model: 'claude-opus-5-5', timings: true })
  const sub1 = threadOf(c, { thread: AG1, agentType: 'general-purpose', model: 'claude-sonnet-5-5', timings: true })
  const sub2 = threadOf(c, { thread: AG2, agentType: 'general-purpose', model: 'claude-sonnet-5-5', timings: true })
  // The half hour before: a main thread that grew to about 110K.
  for (const [k, s] of [-1740, -1610, -1380, -1150, -930, -700, -520, -310, -95].entries()) {
    main.step(BASE + s * 1000, BASE + (s + 6) * 1000, { grow: k === 0 ? 31000 : 9800, out: 500, tools: k % 3 === 2 ? ['Edit'] : ['Read'] })
  }
  const state = { c, live: [], lines: [{ spans: [{ text: '❯ /meter', color: GREY }] }], savedAt: BASE - 80000, dialog: undefined }
  const say = (dot, text, result) => {
    const line = { spans: [{ text: '⏺ ', color: dot }, { text, color: TEXT }] }
    state.lines.push(line, ...(result ? [{ spans: [{ text: `  ⎿  ${result}`, color: GREY }] }] : []))
    return line
  }
  const at = simAt
  let sendLine
  const events = [
    [1800, () => state.lines.push({ spans: [{ text: `❯ ${PROMPT1}`, color: TEXT }] })],
    [2600, () => main.step(at(2000), at(2600), { grow: 900, out: 420, tools: ['Agent'] })],
    [2700, () => {
      addEvent(c, { k: 'agent-call', t0: at(2600), t1: at(2700), thread: MAIN, agent: AG1, agentType: 'general-purpose', model: 'claude-sonnet-5-5', status: 'async_launched', bg: true })
      addEvent(c, { k: 'agent-start', t: at(2700), thread: AG1, agentType: 'general-purpose' })
      noteTiming(c.timings, 'tool.call', 0.04)
      state.live.push({ id: AG1, status: 'running' })
      say(GREEN, 'Agent(Refactor payments, audit with Codex)', 'Backgrounded agent (↓ to manage · ctrl+o to expand)')
    }],
    ...[[2800, 38000, ['Read']], [3500, 23000, ['Grep']], [4200, 23000, ['Read']], [4900, 18000, ['Edit']], [5600, 19000, ['Bash']], [6300, 19000, ['Bash']]].map(([t, grow, tools]) => [t + 400, () => sub1.step(at(t), at(t + 400), { grow, out: 650, tools })]),
    [3400, () => {
      main.step(at(2900), at(3400), { grow: 700, out: 260 })
      say(TEXT, 'The agent refactors payments, then has Codex audit the change in the background.')
    }],
    [6800, () => {
      addEvent(c, { k: 'codex', t0: at(6700), t1: at(6800), thread: AG1, sub: 'exec', bg: true })
      noteTiming(c.timings, 'tool.call', 0.05)
    }],
    [15400, () => state.lines.push({ spans: [{ text: `❯ ${PROMPT2}`, color: TEXT }] })],
    [DIALOG[0], () => {
      main.step(at(15600), at(16200), { grow: 600, out: 180, tools: ['SendMessage'] })
      sendLine = say(GREY, `SendMessage(${LABEL1})`)
      const risk = resumeRisk(c.threads[AG1], at(DIALOG[0]), 5, S.coldTokens)
      state.dialog = { question: resumeQuestion(risk, LABEL1), risk }
    }],
    [DIALOG[1], () => {
      const { risk } = state.dialog
      addEvent(c, { k: 'send', t: at(DIALOG[0]), thread: MAIN, to: AG1, risk: true, gapMs: risk.gapMs, ctx: risk.ctx, mode: 'ask', answer: 'fresh' })
      state.dialog = undefined
      sendLine.spans[0].color = COLORS.cooling
      state.lines.push({ spans: [{ text: '  ⎿  Not sent: you chose a fresh agent', color: GREY }] })
    }],
    [21800, () => main.step(at(21200), at(21800), { grow: 800, out: 380, tools: ['Agent'] })],
    [21900, () => {
      addEvent(c, { k: 'agent-call', t0: at(21800), t1: at(21900), thread: MAIN, agent: AG2, agentType: 'general-purpose', model: 'claude-sonnet-5-5', status: 'async_launched', bg: true })
      addEvent(c, { k: 'agent-start', t: at(21900), thread: AG2, agentType: 'general-purpose' })
      noteTiming(c.timings, 'tool.call', 0.03)
      state.live.push({ id: AG2, status: 'running' })
      say(GREEN, 'Agent(Check refunds, from a short handoff)', 'Backgrounded agent (↓ to manage · ctrl+o to expand)')
    }],
    ...[[22000, 26000], [22700, 14000], [23400, 9000]].map(([t, grow]) => [t + 400, () => sub2.step(at(t), at(t + 400), { grow, out: 500, tools: ['Read'] })]),
    [22700, () => {
      main.step(at(22200), at(22700), { grow: 500, out: 240 })
      say(TEXT, 'A fresh agent checks refunds from a short handoff, instead of resuming the cold one.')
    }],
  ].sort((a, b) => a[0] - b[0])

  let next = 0
  return t => {
    for (; next < events.length && events[next][0] <= t; next++) {
      events[next][1]()
    }
    const now = simAt(t)
    // The timer writes the file a tick after the records change.
    const last = Math.max(...c.records.map(r => ('t1' in r ? r.t1 : r.t)))
    if (now - last >= 15000 && state.savedAt < last) {
      state.savedAt = last + 15000
    }
    return { ...state, now }
  }
}

const promptRows = (text, placeholder) => [
  [{ text: '─'.repeat(COLS), color: RULE }],
  [{ text: '❯ ', color: TEXT }, text === '' && placeholder ? { text: placeholder, color: DIM } : { text, color: TEXT }],
  [{ text: '─'.repeat(COLS), color: RULE }],
  [{ text: '  ? for shortcuts', color: DIM }],
]

/** The pane as register.tsx draws it, in the box Claude Code draws around a pane. */
function paneLines(rows) {
  const inner = COLS - 4
  const labelW = Math.max(...rows.map(r => len(r.label)))
  const lines = [[{ text: `╭${'─'.repeat(COLS - 4)}✕─╮`, color: DIM }]]
  for (const r of rows) {
    wrap(r.value, inner - labelW - 2).forEach((v, i) => {
      const label = i === 0 ? `${r.label.padEnd(labelW)}  ` : ' '.repeat(labelW + 2)
      lines.push([
        { text: '│ ', color: DIM },
        { text: label, color: COLORS.label, bold: true },
        { text: v.padEnd(inner - labelW - 2), color: r.color ?? COLORS.detail },
        { text: ' │', color: DIM },
      ])
    })
  }
  lines.push([{ text: `╰${'─'.repeat(COLS - 2)}╯`, color: DIM }])
  return lines
}

/** The question Claude Code asks for the meter (`$.ui.ask`), as the capture shows it. */
function dialogLines(question) {
  return [
    [{ text: '─'.repeat(COLS), color: RULE }],
    [{ text: ' ☐ ', color: ACCENT }, { text: 'Cold resume', color: TEXT, bold: true }],
    ...wrap(question, COLS - 4).map(l => [{ text: '│ ', color: DIM }, { text: l, color: TEXT }]),
    [{ text: `❯ 1. ${RESUME_OPTIONS.fresh}`, color: ACCENT, bold: true }],
    [{ text: `  2. ${RESUME_OPTIONS.resume}`, color: TEXT }],
    [{ text: '  3. Type something.', color: GREY }],
    [{ text: '─'.repeat(COLS), color: RULE }],
    [{ text: '  4. Chat about this', color: GREY }],
    [{ text: 'Enter to select · ↑/↓ to navigate · Esc to cancel', color: DIM }],
  ]
}

/** Lines stacked from the top, and lines stacked up from the bottom, in ROWS rows; the top ones lose their oldest. */
function layout(top, bottom) {
  const room = ROWS - bottom.length - 1
  const shown = top.slice(Math.max(0, top.length - room))
  const ops = []
  shown.forEach((spans, i) => ops.push(...spansOps(i, 0, spans)))
  bottom.forEach((spans, i) => ops.push(...spansOps(ROWS - bottom.length + i, 0, spans)))
  return { ops, paneTop: ROWS - bottom.length }
}

let paneShot // the pane's rows on the screen, for its still
function claudeFrame(at, t) {
  const s = at(t)
  const typing = t < 1800 ? typed(PROMPT1, t, 200, 1600) : t >= 14100 && t < 15400 ? typed(PROMPT2, t, 14100, 15300) : ''
  const transcript = s.lines.flatMap(l => wrapSpans(l.spans, COLS, 5))
  let bottom
  if (s.dialog) {
    bottom = dialogLines(s.dialog.question)
  } else {
    const summary = summarize([{ sid: 'demo', startedAt: BASE - 1800000, records: s.c.records, groups: s.c.groups }], S)
    const rows = paneRows(s.c, s.live, s.now, { main: summary.ttl.main.min, subagent: summary.ttl.subagent.min }, { summary, files: filesText({ root: DATA, savedAt: s.savedAt }, s.now) })
    const pane = paneLines(rows)
    bottom = [...pane, ...promptRows(typing)]
    paneShot = { top: ROWS - bottom.length, rows: pane.length, text: rows }
  }
  const fast = t >= SIM[1][0] && t < SIM[4][0]
  return { ...layout([[], ...transcript, []], bottom), title: 'Claude Code  ·  /meter, and the cold resume guard (ask)', clock: `${fast ? '⏩ ' : ''}${clock(s.now)}` }
}

// ---- scenes 2 and 3: the companion's hooks in Codex and Devin ----

const PROMPT3 = 'fix what the audit found'
const CODEX_MS = 7500
const DEVIN_MS = 8500

function codexFrame(t) {
  const last = { t0: BASE, ctx: 180000, model: 'gpt-6.1-sol' }
  const now = BASE + 72 * 60000
  const said = promptAnswer(idleRisk(last, now, { ...S, tool: 'codex' }), 'warn', false).systemMessage
  const top = [
    [],
    [{ text: '  >_ ', color: GREY }, { text: 'OpenAI Codex', color: TEXT, bold: true }, { text: ' (v0.160.1)', color: DIM }],
    [{ text: '     ~/work/shop', color: DIM }],
    [],
  ]
  if (t >= 1800) top.push([{ text: `› ${PROMPT3}`, color: TEXT }], [])
  if (t >= 2100) top.push(...wrapSpans([{ text: '↳ Hook · ', color: GREY }, { text: said, color: TEXT }], COLS, 2), [])
  if (t >= 3600) top.push([{ text: '• ', color: TEXT }, { text: 'Reading the audit findings first.', color: TEXT }])
  const bottom = [[{ text: `› ${t < 1800 ? typed(PROMPT3, t, 300, 1500) : ''}`, color: TEXT }], []]
  return { ...layout(top, bottom), title: 'Codex CLI  ·  the companion\'s hook (warn)', clock: clock(now) }
}

function devinFrame(t) {
  const last = { t0: BASE, ctx: 120000, model: 'swe-2-high' }
  const now = BASE + 65 * 60000
  const held = promptAnswer(idleRisk(last, now, { ...S, tool: 'devin' }), 'ask', false).reason
  const transcript = []
  if (t >= 1800) transcript.push([{ text: `❭ ${PROMPT3}`, color: TEXT }], ...wrapSpans([{ text: ' ✱ ', color: COLORS.cooling }, { text: `Prompt blocked: ${held}`, color: TEXT }], COLS, 3))
  if (t >= 6000) transcript.push([{ text: `❭ ${PROMPT3}`, color: TEXT }])
  const input = t < 1800 ? typed(PROMPT3, t, 300, 1500) : t >= 4600 && t < 6000 ? PROMPT3 : ''
  const footer = 'ctrl+v to paste image in clipboard'
  const bottom = [
    ...transcript,
    [{ text: '─'.repeat(COLS), color: RULE }],
    [{ text: '❭ ', color: TEXT }, input === '' ? { text: 'Ask Devin to build features, fix bugs, or work on your code', color: DIM } : { text: input, color: TEXT }],
    [{ text: '─'.repeat(COLS), color: RULE }],
    [{ text: 'SWE-2 High', color: GREY }, { text: footer.padStart(COLS - len('SWE-2 High')), color: DIM }],
  ]
  return { ...layout([], bottom), title: 'Devin CLI  ·  the companion\'s hook (ask)', clock: clock(now) }
}

// ---- scene 4: the companion's report over the three tools ----

/** A small seeded random, so the report's sessions come out the same every run. */
function random(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}

/** A week of sessions in the three tools, for the report. */
function weekOfSessions() {
  const rnd = random(7)
  const pick = (lo, hi) => Math.round(lo + rnd() * (hi - lo))
  const MIN = 60000
  const sessions = []
  const weekStart = BASE - 6 * 86400000
  // Claude Code: a main thread, subagents whose Agent calls report 5m cache writes, a few cold resumes.
  const claudeQuota = [38, 40, 43, 44, 47, 49, 52, 53, 56, 58, 61]
  for (let k = 0; k < 11; k++) {
    const c = newCollector()
    const start = weekStart + k * 0.55 * 86400000
    const model = k % 3 === 2 ? 'claude-sonnet-5-5' : 'claude-opus-5-5'
    const main = threadOf(c, { model })
    let t = start
    const steps = pick(28, 46)
    for (let i = 0; i < steps; i++) {
      t += (i === 20 && k % 4 === 1 ? 22 * MIN : pick(15, 200) * 1000)
      main.step(t, t + 5000, { grow: i === 0 ? pick(24000, 34000) : pick(1500, 4200), out: pick(200, 1400), tools: ['Read'] })
      if (i === 26 && k === 7) {
        t += 75 * MIN
        main.step(t, t + 5000, { cold: true, grow: 1500, out: 600 })
      }
      if (i % 12 === 0) {
        addEvent(c, { k: 'quota', t: t + 5000, thread: MAIN, windowMin: 10080, used: claudeQuota[k] + i / 12, resetsAt: weekStart + 7 * 86400000 })
      }
    }
    for (let a = 0; a < 1 + (k % 3); a++) {
      const id = `a${k}${a}d${(k * 7919 + a * 104729).toString(16)}`
      const agentType = ['Explore', 'general-purpose', 'Plan'][(k + a) % 3]
      const agentModel = agentType === 'Explore' ? 'claude-haiku-4-5' : 'claude-sonnet-5-5'
      let s = start + pick(5, 60) * MIN
      const called = s - 2000
      addEvent(c, { k: 'agent-start', t: s, thread: id, agentType })
      const sub = threadOf(c, { thread: id, agentType, model: agentModel })
      const n = pick(6, 14)
      for (let i = 0; i < n; i++) {
        s += (i === n - 2 && (k === 3 || k === 9) ? (k === 3 ? 14 : 9) * MIN : pick(5, 40) * 1000)
        sub.step(s, s + 3000, { grow: i === 0 ? pick(18000, 26000) : pick(6000, 14000), cold: i === n - 2 && (k === 3 || k === 9), out: pick(200, 900), tools: ['Grep'] })
      }
      addEvent(c, { k: 'agent-stop', t: s + 4000, thread: id, agentType })
      addEvent(c, { k: 'agent-call', t0: called, t1: s + 4000, thread: MAIN, agent: id, agentType, model: agentModel, status: 'completed', tokens: pick(40000, 160000), cw5m: pick(20000, 60000) })
      addEvent(c, { k: 'ttl', t: s + 4000, thread: id, ttl: '5m', source: 'agent-call' })
    }
    if (k % 4 === 0) {
      addEvent(c, { k: 'codex', t0: start + 30 * MIN, t1: start + 41 * MIN, thread: MAIN, sub: 'review' })
    }
    sessions.push({ sid: `claude-${k}`, startedAt: start, records: c.records, groups: c.groups, tool: 'claude' })
  }
  // Codex: no cache writes; after a gap, the context is read back or sent again, as measured on one machine.
  const codexGaps = [[7, true], [14, true], [41, true], [74, true], [6, true], [22, false], [52, false], [95, false], [9, true], [18, true], [180, false], [8, true], [33, true], [110, false], [6, false], [12, true], [7, true]]
  let codexGap = 0
  for (let k = 0; k < 5; k++) {
    const c = newCollector()
    const start = weekStart + (0.3 + k * 1.2) * 86400000
    const main = threadOf(c, { model: 'gpt-6.1-sol', writes: false })
    let t = start
    const steps = pick(24, 36)
    for (let i = 0; i < steps; i++) {
      const gap = i % 9 === 8 ? codexGaps[codexGap++ % codexGaps.length] : undefined
      t += gap ? gap[0] * MIN : pick(8, 90) * 1000
      main.step(t, t + 6000, { grow: i === 0 ? pick(14000, 20000) : pick(2500, 7000), cold: gap ? !gap[1] : false, out: pick(300, 2400), tools: ['exec'] })
      if (i % 9 === 0) {
        addEvent(c, { k: 'quota', t: t + 6000, thread: MAIN, windowMin: 10080, used: 14 + k * 2 + i / 9, resetsAt: weekStart + 8 * 86400000 })
      }
    }
    if (k % 2 === 1) {
      addCompaction(c, MAIN, 'gpt-6.1-sol', { in: 160000, cr: 0, cw: 0, out: 9000 })
      addEvent(c, { k: 'compact', t0: t + 1000, t1: t + 20000, thread: MAIN, trigger: 'unknown', stepsSeen: 0 })
    }
    sessions.push({ sid: `codex-${k}`, startedAt: start, records: c.records, groups: c.groups, tool: 'codex' })
  }
  // Devin: SWE-2 with its keepalive pings, which stop after a while; past ten minutes the context goes again.
  const devinGaps = [[6, false], [8, true], [7, false], [13, false], [24, false], [9, false]]
  let devinGap = 0
  for (let k = 0; k < 3; k++) {
    const c = newCollector()
    const start = weekStart + (1 + k * 2) * 86400000
    const main = threadOf(c, { model: 'swe-2-high', writes: false })
    let t = start
    for (let i = 0; i < 22; i++) {
      const gap = i % 10 === 9 ? devinGaps[devinGap++ % devinGaps.length] : undefined
      if (i % 7 === 3) {
        for (let p = 0; p < 4; p++) {
          t += 285000
          main.step(t, t + 2000, { keepalive: true })
        }
      }
      t += gap ? gap[0] * MIN : pick(10, 80) * 1000
      main.step(t, t + 7000, { grow: i === 0 ? pick(16000, 22000) : pick(3000, 8000), cold: gap ? !gap[1] : false, out: pick(300, 1800), tools: ['exec'] })
    }
    if (k === 1) {
      addCompaction(c, MAIN, 'compactor', { in: 140000, cr: 0, cw: 0, out: 7000 })
      addEvent(c, { k: 'compact', t0: t + 1000, t1: t + 15000, thread: MAIN, trigger: 'unknown', stepsSeen: 0 })
    }
    sessions.push({ sid: `devin-${k}`, startedAt: start, records: c.records, groups: c.groups, tool: 'devin' })
  }
  return sessions
}

const COMMAND = 'node ~/.claude/plugins/marketplaces/oxen-pet/tools/meter/oxen-meter.mjs report'
const REPORT_MS = 10000
const reportLines = [
  importLine({ codex: { files: 3, bytes: 7.4e6, sessions: ['a', 'b'] }, devin: { sessions: ['c'] } }),
  ...reportText(summarize(weekOfSessions(), S), { days: 7, skipped: 0 }).split('\n'),
]

function reportFrame(t) {
  const top = [[{ text: '$ ', color: GREEN }, { text: typed(COMMAND, t, 300, 1700), color: TEXT }]]
  if (t >= 2100) {
    top.push(...reportLines.flatMap(l => wrapSpans([{ text: l, color: TEXT }], COLS, 11)), [{ text: '$ ', color: GREEN }])
  }
  return { ...layout(top, []), title: 'Terminal  ·  the companion\'s report over all three tools', clock: '' }
}

// ---- the recording ----

function frames() {
  const claude = scene1()
  const all = []
  const stills = {}
  for (let t = 0; t < SCENE1_MS; t += FRAME_MS) {
    all.push(claudeFrame(claude, t))
    if (t === 15200) stills.pane = { index: all.length - 1, ...paneShot }
  }
  for (let t = 0; t < CODEX_MS; t += FRAME_MS) all.push(codexFrame(t))
  for (let t = 0; t < DEVIN_MS; t += FRAME_MS) all.push(devinFrame(t))
  for (let t = 0; t < REPORT_MS; t += FRAME_MS) all.push(reportFrame(t))
  stills.report = { index: all.length - 1 }
  return { all, stills }
}

/** A frame as plain text, for --text. */
function asLines(f) {
  const grid = Array.from({ length: ROWS }, () => Array(COLS).fill(' '))
  for (const op of f.ops) {
    ;[...op.text].forEach((ch, i) => {
      if (op.col + i < COLS) grid[op.row][op.col + i] = ch
    })
  }
  return `== ${f.title} ${f.clock}\n${grid.map(r => r.join('').trimEnd()).join('\n')}`
}

const { all, stills } = frames()
if (asText) {
  const at = ms => Math.round(ms / FRAME_MS)
  const s2 = SCENE1_MS / FRAME_MS
  for (const i of [at(7000), at(11500), stills.pane.index, at(18000), at(26900), s2 + at(7400), s2 + at(CODEX_MS) + at(3000), s2 + at(CODEX_MS) + at(8400), all.length - 1]) {
    console.log(asLines(all[i]))
  }
  console.log('\nThe pane, for the README:\n' + stills.pane.text.map(r => `${r.label.padEnd(Math.max(...stills.pane.text.map(x => x.label.length)))}  ${r.value}`).join('\n'))
  process.exit(0)
}

const CW = 9
const CH = 18
const PAD = 16
const BAR = 28
const W = PAD * 2 + COLS * CW
const H = BAR + PAD + ROWS * CH + PAD / 2

const PAGE = `<!doctype html><meta charset="utf-8"><body style="margin:0"><canvas id="c" width="${W}" height="${H}"></canvas><script>
const g = document.getElementById('c').getContext('2d')
const at = (col, row) => [${PAD} + col * ${CW}, ${BAR + PAD} + row * ${CH}]
// Box edges drawn as lines, so they join across rows as a terminal joins them.
function edge(ch, x, y) {
  const mx = x + ${CW / 2}, my = y + ${CH / 2}
  g.fillRect(...{ '─': [x, my, ${CW}, 1], '│': [mx, y, 1, ${CH}] }[ch] ?? [0, 0, 0, 0])
  if ('╭╮╰╯'.includes(ch)) {
    const r = 4
    const right = ch === '╭' || ch === '╰', down = ch === '╭' || ch === '╮'
    g.fillRect(right ? mx + r : x, my, right ? ${CW} - ${CW / 2} - r : ${CW / 2} - r + 1, 1)
    g.fillRect(mx, down ? my + r : y, 1, down ? ${CH / 2} - r : ${CH / 2} - r + 1)
    g.beginPath()
    g.arc(mx + (right ? r : -r) + 0.5, my + (down ? r : -r) + 0.5, r, ...{ '╭': [Math.PI, 1.5 * Math.PI], '╮': [1.5 * Math.PI, 2 * Math.PI], '╰': [0.5 * Math.PI, Math.PI], '╯': [0, 0.5 * Math.PI] }[ch])
    g.strokeStyle = g.fillStyle
    g.lineWidth = 1
    g.stroke()
  }
}
function text({ row, col, text, color, bold }) {
  g.font = (bold ? 'bold ' : '') + '15px Menlo, "DejaVu Sans Mono", monospace'
  g.fillStyle = color
  g.textBaseline = 'middle'
  ;[...text].forEach((ch, i) => {
    const [x, y] = at(col + i, row)
    if ('─│╭╮╰╯'.includes(ch)) edge(ch, x, y)
    else if (ch !== ' ') g.fillText(ch, x, y + ${CH / 2} + 1)
  })
}
window.draw = (ops, title, clock) => {
  g.fillStyle = '#2a2d3a'; g.fillRect(0, 0, ${W}, ${H})
  ;['#ff5f57', '#febc2e', '#28c840'].forEach((c, i) => { g.fillStyle = c; g.beginPath(); g.arc(18 + i * 20, ${BAR / 2}, 6, 0, 7); g.fill() })
  g.font = '13px -apple-system, "Helvetica Neue", sans-serif'; g.textBaseline = 'middle'
  g.fillStyle = '#a3a9c4'; g.textAlign = 'center'; g.fillText(title, ${W / 2}, ${BAR / 2} + 1)
  g.textAlign = 'right'; g.fillText(clock, ${W - PAD}, ${BAR / 2} + 1); g.textAlign = 'left'
  g.fillStyle = '#14161f'; g.fillRect(0, ${BAR}, ${W}, ${H - BAR})
  for (const op of ops) text(op)
  return document.getElementById('c').toDataURL('image/png')
}
</script>`

async function devtools(dir) {
  const chrome = spawn(chromePath, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${join(dir, 'profile')}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' })
  const portFile = join(dir, 'profile', 'DevToolsActivePort')
  for (let i = 0; !existsSync(portFile); i++) {
    if (i > 100) throw new Error('Chrome did not start')
    await new Promise(r => setTimeout(r, 100))
  }
  const port = readFileSync(portFile, 'utf8').split('\n')[0]
  const page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(p => p.type === 'page')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => Object.assign(ws, { onopen: resolve, onerror: reject }))
  const pending = new Map()
  ws.onmessage = ({ data }) => {
    const m = JSON.parse(data)
    pending.get(m.id)?.(m)
    pending.delete(m.id)
  }
  let id = 0
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      pending.set(++id, m => (m.error ? reject(new Error(m.error.message)) : resolve(m.result)))
      ws.send(JSON.stringify({ id, method, params }))
    })
  const evaluate = async expression => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
    return r.result.value
  }
  // Chrome writes to its profile until it exits, so the folder goes only after that.
  const exited = new Promise(resolve => chrome.once('exit', resolve))
  return { evaluate, send, close: () => (ws.close(), chrome.kill(), exited) }
}

const ffmpeg = (...a) => {
  const r = spawnSync('ffmpeg', ['-y', '-v', 'error', ...a], { stdio: 'inherit' })
  if (r.error || r.status !== 0) throw new Error(`ffmpeg failed${r.error ? `: ${r.error.message}` : ''}`)
}

const dir = mkdtempSync(join(tmpdir(), 'oxen-meter-demo-'))
const browser = await devtools(dir)
try {
  writeFileSync(join(dir, 'page.html'), PAGE)
  await browser.send('Page.navigate', { url: pathToFileURL(join(dir, 'page.html')).href })
  while ((await browser.evaluate('typeof draw')) !== 'function') await new Promise(r => setTimeout(r, 50))
  const png = i => join(dir, `${String(i).padStart(4, '0')}.png`)
  let last
  for (const [i, f] of all.entries()) {
    const key = JSON.stringify([f.ops, f.title, f.clock])
    if (key === last) {
      copyFileSync(png(i - 1), png(i))
      continue
    }
    last = key
    const data = await browser.evaluate(`draw(${key.slice(1, -1)})`)
    writeFileSync(png(i), Buffer.from(data.split(',')[1], 'base64'))
  }
  ffmpeg('-framerate', String(1000 / FRAME_MS), '-i', join(dir, '%04d.png'), '-vf', 'split[a][b];[a]palettegen=max_colors=96:stats_mode=full[p];[b][p]paletteuse=dither=none:diff_mode=rectangle', out)
  console.log(`wrote ${out}: ${all.length} frames, ${W}×${H}`)
  // The pane alone, its box and the rows in it; and the report, the whole terminal.
  const p = stills.pane
  ffmpeg('-i', png(p.index), '-vf', `crop=${COLS * CW + CW}:${p.rows * CH}:${PAD - CW / 2}:${BAR + PAD + p.top * CH}`, paneOut)
  copyFileSync(png(stills.report.index), reportOut)
  console.log(`wrote ${paneOut} and ${reportOut}`)
} finally {
  await browser.close()
  rmSync(dir, { recursive: true, force: true, maxRetries: 5 })
}
