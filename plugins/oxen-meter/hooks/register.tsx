import type { EngineInterface, Register, TurnStepResult } from 'claude-code'

import { roleOf, summarize, ttlOf } from './analyze'
import type { Role } from './analyze'
import { codexCallOf, outcomeOf } from './codex'
import { dataPathError, dataRootOf, dataTargetError, sessionPath } from './dataPath'
import { projectLabel } from './project'
import { MAIN, addEvent, addStep, agentCallOf, newCollector, stepRecordOf, threadOf } from './record'
import type { Collector } from './record'
import { COLORS, filesText, fmtDur, fmtTokens, paneRows, reportText, rowsText, threadLabel } from './report'
import { RESUME_OPTIONS, coldStartText, freshReason, resolveRecipient, resumeQuestion, resumeRisk, resumeToast } from './resume'
import type { LiveAgent } from './report'
import { TOMBSTONE, isExpired, readSessionText, restoreCollector, sessionText } from './sessionFile'
import type { SessionData } from './analyze'
import { readSettings } from './settings'
import type { Settings } from './settings'
import { noteTiming } from './timing'

const COMMAND = 'meter'
const PANE_ID = 'meter'
const TICK_MS = 15000 // how often an open pane redraws and a changed session is written
const FLUSH_MS = 30000 // the longest a changed session waits for its file while no main turn ends
const DAY_MS = 86400000
const SALT_KEY = 'salt' // in $.store: the user's own salt for project hashes
const SWEPT_KEY = 'sweptAt' // in $.store: when expired session files were last emptied
const REPORT_DAYS = 7
const MAX_REPORT_DAYS = 365

/** The meter's state for the session: the collector, and where and when its file was written. */
type Meter = {
  c: Collector
  root: string | undefined // the data folder; undefined writes nothing
  sid?: string
  startedAt: number
  project: string
  version: string
  savedAt?: number
  triedAt: number
  error?: string
  writing: boolean
  turnEnded: boolean // a main turn ended since the last write
  paneOpen: boolean
  ttl: Record<Role, number> // each role's TTL in minutes, as the last tick worked it out, for the hot path
  warned: Record<string, number> // the thread's last step the user was last warned about, so one idle spell warns once
}

/** Now, or undefined when the clock call fails: a hook that cannot read the time records nothing and goes on. */
async function nowOr($: EngineInterface) {
  try {
    return await $.clock.now()
  } catch {
    return undefined
  }
}

/** The session's agents as the pane needs them, or none when the list call fails. */
async function liveAgents($: EngineInterface): Promise<LiveAgent[]> {
  try {
    return (await $.agent.list()).map(a => ({ id: a.id, status: a.status }))
  } catch {
    return []
  }
}

/** The session's agents with the names SendMessage addresses them by, or none when the list call fails. */
async function namedAgents($: EngineInterface): Promise<{ id: string; name?: string }[]> {
  try {
    return (await $.agent.list()).map(a => ({ id: a.id, ...(a.name !== undefined ? { name: a.name } : {}) }))
  } catch {
    return []
  }
}

/** The stat of `path` with where it lands, or undefined when nothing is there. */
async function statOr($: EngineInterface, path: string) {
  try {
    return await $.fs.stat(path, { resolve: true })
  } catch {
    return undefined
  }
}

const parentOf = (path: string) => path.slice(0, Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')))

/** Writes `text` to `path` in the data folder `root`, once the guard allows it; throws the guard's reason when it does not. */
async function writeGuarded($: EngineInterface, root: string, path: string, text: string) {
  const spelled = dataPathError(root, path)
  if (spelled !== undefined) {
    throw new Error(spelled)
  }
  const target = dataTargetError(path, { parent: await statOr($, parentOf(root)), root: await statOr($, root), dir: await statOr($, parentOf(path)), file: await statOr($, path) })
  if (target !== undefined) {
    throw new Error(target)
  }
  await $.fs.write(path, text)
}

/** The meter's version, from its own manifest. */
async function versionOf($: EngineInterface) {
  try {
    const version = (JSON.parse(await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`)) as { version?: unknown }).version
    return typeof version === 'string' ? version : 'unknown'
  } catch {
    return 'unknown'
  }
}

/** The session's project as the records name it, hashed with the user's own salt unless they turned hashing off. */
async function projectOf($: EngineInterface, hash: boolean) {
  try {
    let salt = await $.store.get(SALT_KEY)
    if (typeof salt !== 'string') {
      salt = crypto.randomUUID()
      await $.store.set(SALT_KEY, salt)
    }
    return await projectLabel(await $.session.root(), salt as string, hash)
  } catch {
    return ''
  }
}

/** The session's id, or undefined when the call fails. */
async function sessionIdOr($: EngineInterface) {
  try {
    return await $.session.id()
  } catch {
    return undefined
  }
}

/** Writes the session's file when the session changed, and notes when it did or why not. Never throws. */
async function flush($: EngineInterface, m: Meter, s: Settings) {
  if (m.root === undefined || m.writing || !m.c.dirty) {
    return
  }
  m.writing = true
  try {
    m.sid ??= await sessionIdOr($)
    const now = await $.clock.now()
    m.triedAt = now
    if (m.sid === undefined) {
      throw new Error('the session has no id yet.')
    }
    let costUsd: number | undefined
    try {
      costUsd = (await $.session.usage()).cost?.usd
    } catch {
      // The file goes without the cost.
    }
    const settings = { mainTtl: s.mainTtl, subagentTtl: s.subagentTtl, coldTokens: s.coldTokens, outputWeight: s.outputWeight }
    const text = sessionText(m.c, { sid: m.sid, project: m.project, startedAt: m.startedAt, savedAt: now, version: m.version, settings, ...(costUsd !== undefined ? { costUsd } : {}) })
    // Records added while the file is written mark it changed again.
    m.c.dirty = false
    await writeGuarded($, m.root, sessionPath(m.root, m.sid), text)
    m.savedAt = now
    m.error = undefined
    m.turnEnded = false
  } catch (err) {
    m.c.dirty = true
    m.error = err instanceof Error ? err.message : String(err)
  } finally {
    m.writing = false
  }
}

/** Goes on from the session's file when it has one: after a reload, or in a resumed session. */
async function restore($: EngineInterface, m: Meter) {
  if (m.root === undefined || m.sid === undefined) {
    return
  }
  try {
    const file = readSessionText(await $.fs.read(sessionPath(m.root, m.sid)))
    if (file) {
      // What arrived before the file was read (a classic SessionStart) goes on after it.
      const restored = restoreCollector(file)
      for (const r of m.c.records) {
        if (r.k === 'step') {
          addStep(restored, r)
        } else {
          addEvent(restored, r)
        }
      }
      restored.dirty = m.c.records.length > 0
      m.c = restored
      m.startedAt = file.startedAt
    }
  } catch {
    // No file yet: a new session.
  }
}

/** Empties the session files past the retention days, once a day: the meter cannot delete a file. */
async function sweep($: EngineInterface, m: Meter, s: Settings) {
  if (m.root === undefined) {
    return
  }
  try {
    const now = await $.clock.now()
    const last = await $.store.get(SWEPT_KEY)
    if (typeof last === 'number' && now - last < DAY_MS) {
      return
    }
    await $.store.set(SWEPT_KEY, now)
    const dir = `${m.root}/sessions`
    for (const f of await $.fs.list(dir)) {
      const path = `${dir}/${f.name}`
      if (f.kind === 'file' && !f.isLink && f.size > TOMBSTONE.length && f.name !== `${m.sid}.json` && isExpired(f.mtimeMs, now, s.retentionDays) && dataPathError(m.root, path) === undefined) {
        await writeGuarded($, m.root, path, TOMBSTONE)
      }
    }
  } catch {
    // Expired files wait for the next session.
  }
}

/** The session as the summary reads it. */
const sessionData = (m: Meter): SessionData => ({ sid: m.sid ?? '', startedAt: m.startedAt, records: m.c.records, groups: m.c.groups })

/** The pane's rows now. */
async function rowsNow($: EngineInterface, m: Meter, s: Settings) {
  const now = (await nowOr($)) ?? 0
  const summary = summarize([sessionData(m)], s)

  return paneRows(m.c, await liveAgents($), now, { main: summary.ttl.main.min, subagent: summary.ttl.subagent.min }, { summary, files: filesText(m, now) })
}

/** `/meter report [days]`: the session files of the last days, added up, with this session written first. */
async function report($: EngineInterface, m: Meter, s: Settings, arg: string | undefined) {
  const asked = Number.parseInt(arg ?? '', 10)
  const days = Number.isFinite(asked) && asked > 0 ? Math.min(asked, MAX_REPORT_DAYS) : REPORT_DAYS
  if (m.root === undefined) {
    return `oxen-meter: ${filesText(m, 0)}`
  }
  await flush($, m, s)
  const now = await $.clock.now()
  const dir = `${m.root}/sessions`
  const sessions: SessionData[] = []
  let skipped = 0
  for (const f of await $.fs.list(dir).catch(() => [])) {
    if (f.kind !== 'file' || f.isLink || !f.name.endsWith('.json') || now - f.mtimeMs > days * DAY_MS) {
      continue
    }
    const text = await $.fs.read(`${dir}/${f.name}`).catch(() => '')
    const file = readSessionText(text)
    if (file) {
      sessions.push({ sid: file.sid, startedAt: file.startedAt, records: file.records, groups: file.groups })
    } else if (text.trim() === TOMBSTONE) {
      skipped += 1
    }
  }

  return reportText(summarize(sessions, s), { days, skipped })
}

export const register: Register = (on, options) => {
  const settings = readSettings(options)
  const m: Meter = { c: newCollector(), root: undefined, startedAt: 0, project: '', version: 'unknown', triedAt: 0, writing: false, turnEnded: false, paneOpen: false, ttl: { main: 60, subagent: 5 }, warned: {} }
  const refreshTtl = () => {
    const ttl = ttlOf(m.c.records, settings)
    m.ttl = { main: ttl.main.min, subagent: ttl.subagent.min }
  }

  on('session.start', async ($, e, next) => {
    m.root = dataRootOf($.plugin.root, settings.dataDir)
    m.version = await versionOf($)
    m.project = await projectOf($, settings.hashProject)
    m.sid = await sessionIdOr($)
    try {
      m.startedAt = (await $.session.usage()).startedAt
    } catch {
      m.startedAt = (await nowOr($)) ?? 0
    }
    await restore($, m)
    refreshTtl()
    await sweep($, m, settings)
    try {
      await $.command.register({ name: COMMAND, description: 'oxen-meter: open or close the prompt cache pane; /meter report [days] adds up past sessions', argumentHint: '[report [days]]', immediate: true })
    } catch {
      // Without the command the meter still records; only the pane and the report are missing.
    }
    $.clock.every(TICK_MS, async () => {
      if (m.paneOpen) {
        $.ui.invalidate('ui.render')
      }
      refreshTtl()
      const now = (await nowOr($)) ?? 0
      if (m.c.dirty && (m.turnEnded || now - m.triedAt >= FLUSH_MS)) {
        await flush($, m, settings)
      }
    })

    return next(e)
  })

  // Every model request of every loop: passed on untouched, then recorded from its usage. Never rewritten or answered.
  // A thread waking past its TTL with a large context gets one toast for that idle spell: it cannot be stopped here.
  on('turn.step', async function* ($, e, next) {
    let mark = performance.now()
    const t0 = await nowOr($)
    const thread = threadOf(e.agentId)
    let coldStart = false
    try {
      const state = m.c.threads[thread]
      const risk = t0 === undefined ? undefined : resumeRisk(state, t0, m.ttl[roleOf(thread)], settings.coldTokens, 1)
      if (risk && state) {
        coldStart = true
        if (settings.resumeGuard !== 'off' && m.warned[thread] !== state.lastT0) {
          m.warned[thread] = state.lastT0
          $.ui.toast(coldStartText(risk, threadLabel(thread, m.c)))
        }
      }
    } catch {
      // The step goes on unwarned.
    }
    let own = performance.now() - mark
    let result: TurnStepResult | undefined
    try {
      result = yield* next(e)
      return result
    } finally {
      mark = performance.now()
      const t1 = await nowOr($)
      try {
        if (t0 !== undefined && t1 !== undefined) {
          const r = stepRecordOf(e, result, t0, t1, m.c)
          addStep(m.c, coldStart ? { ...r, coldStart: true } : r)
        }
      } catch {
        // A step the meter cannot record goes on as the engine sent it.
      }
      own += performance.now() - mark
      noteTiming(m.c.timings, 'turn.step', own)
    }
  })

  // A Bash call: a Codex handoff or an outcome, by the command's text, which is never kept.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const mark = performance.now()
    let codex: ReturnType<typeof codexCallOf>
    let outcome: ReturnType<typeof outcomeOf>
    try {
      codex = codexCallOf(e.command)
      outcome = outcomeOf(e.command)
    } catch {
      return next(e)
    }
    if (!codex && !outcome) {
      noteTiming(m.c.timings, 'tool.call', performance.now() - mark)
      return next(e)
    }
    const t0 = await nowOr($)
    const result = await next(e)
    const t1 = await nowOr($)
    try {
      const thread = threadOf(e.agentId)
      const failed = 'deny' in result || result.isError === true
      const bg = e.run_in_background === true || (!failed && result.result?.backgroundTaskId !== undefined)
      if (codex && t0 !== undefined && t1 !== undefined) {
        addEvent(m.c, { k: 'codex', t0, t1, thread, sub: codex.sub, ...(bg ? { bg: true as const } : {}), ...(failed ? { failed: true as const } : {}) })
      }
      if (outcome && !failed && t1 !== undefined) {
        addEvent(m.c, { k: 'outcome', t: t1, thread, outcome })
      }
    } catch {
      // The call's result stands whatever the meter makes of it.
    }
    noteTiming(m.c.timings, 'tool.call', performance.now() - mark)

    return result
  })

  // An Agent call: the agent it started, its type and model, and the TTL its cache writes used.
  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    const t0 = await nowOr($)
    const result = await next(e)
    const mark = performance.now()
    const t1 = await nowOr($)
    try {
      if (t0 !== undefined && t1 !== undefined) {
        const records = agentCallOf('deny' in result ? undefined : result.result, t0, t1, threadOf(e.agentId))
        for (const r of records) {
          addEvent(m.c, r)
        }
        const started = records[0]?.k === 'agent-call' ? records[0].agent : undefined
        if (typeof e.name === 'string' && e.name !== '' && started !== undefined) {
          m.c.names[e.name] = started
        }
      }
    } catch {
      // The call's result stands whatever the meter makes of it.
    }
    noteTiming(m.c.timings, 'tool.call', performance.now() - mark)

    return result
  })

  on('classic.SubagentStart', async ($, e, next) => {
    const t = await nowOr($)
    if (t !== undefined && typeof e.agent_id === 'string') {
      addEvent(m.c, { k: 'agent-start', t, thread: e.agent_id, agentType: String(e.agent_type ?? '') })
    }
    return next(e)
  })

  on('classic.SubagentStop', async ($, e, next) => {
    const t = await nowOr($)
    if (t !== undefined && typeof e.agent_id === 'string') {
      addEvent(m.c, { k: 'agent-stop', t, thread: e.agent_id, agentType: String(e.agent_type ?? '') })
    }
    return next(e)
  })

  // A message from Claude that resumes an agent whose cache likely went cold: a toast (warn), a question (ask), or a
  // record alone (off). Only the user's "Spawn a fresh agent" keeps the message back; no answer sends it.
  on('session.send', async ($, e, next) => {
    if (e.origin.kind !== 'model') {
      return next(e)
    }
    const t = await nowOr($)
    const agent = t === undefined ? undefined : resolveRecipient(e.to, m.c, await namedAgents($))
    if (t === undefined || agent === undefined) {
      return next(e)
    }
    const state = m.c.threads[agent]
    const risk = resumeRisk(state, t, m.ttl[roleOf(agent)], settings.coldTokens)
    const sent = { k: 'send' as const, t, thread: threadOf(e.agentId), to: agent, risk: risk !== undefined, ...(state ? { gapMs: t - state.lastT0, ctx: state.lastCtx } : {}), mode: settings.resumeGuard }
    if (!risk || !state || settings.resumeGuard === 'off') {
      addEvent(m.c, sent)
      return next(e)
    }
    const label = threadLabel(agent, m.c)
    m.warned[agent] = state.lastT0
    if (settings.resumeGuard === 'warn') {
      $.ui.toast(resumeToast(risk, label))
      addEvent(m.c, sent)
      return next(e)
    }
    const answer = await $.ui.ask(resumeQuestion(risk, label), { header: 'Cold resume', options: [RESUME_OPTIONS.fresh, RESUME_OPTIONS.resume] }).catch(() => undefined)
    const chose = answer === RESUME_OPTIONS.fresh ? 'fresh' : answer === RESUME_OPTIONS.resume ? 'resume' : 'unanswered'
    addEvent(m.c, { ...sent, answer: chose })
    if (chose === 'fresh') {
      return { isDelivered: false as const, reason: freshReason(risk, label) }
    }

    return next(e)
  })

  // A resumed session: how long it sat and whether its cache likely expired, as Claude Code worked it out.
  on('classic.SessionStart', async ($, e, next) => {
    try {
      const idleS = e.seconds_since_last_response
      const t = await nowOr($)
      if ((e.source === 'resume' || e.source === 'fork') && typeof idleS === 'number' && t !== undefined) {
        const ctx = e.context_tokens ?? 0
        const expired = e.prompt_cache_likely_expired === true
        addEvent(m.c, { k: 'main-resume', t, thread: MAIN, idleS, ctx, expired })
        if (expired && ctx >= settings.coldTokens && settings.resumeGuard !== 'off') {
          $.ui.toast(`oxen-meter: this session sat ${fmtDur(idleS * 1000)} and its cache likely expired: the first request writes its ${fmtTokens(ctx)} context again.`)
        }
      }
    } catch {
      // The session starts as Claude Code starts it.
    }
    return next(e)
  })

  // A model switch reports the main thread's TTL: a measured one.
  on('classic.PostModelSwitch', async ($, e, next) => {
    const t = await nowOr($)
    if (t !== undefined && (e.cache_ttl === '5m' || e.cache_ttl === '1h')) {
      addEvent(m.c, { k: 'ttl', t, thread: MAIN, ttl: e.cache_ttl, source: 'model-switch' })
    }
    return next(e)
  })

  // A compaction: passed on untouched, then recorded with its sizes and the summarizer's tokens.
  on('session.compact', async ($, e, next) => {
    if (e.trigger === 'precompute') {
      return next(e)
    }
    const t0 = await nowOr($)
    const stepsBefore = m.c.stepsInCompaction
    m.c.compacting += 1
    let result: Awaited<ReturnType<typeof next>>
    try {
      result = await next(e)
    } finally {
      m.c.compacting -= 1
    }
    const t1 = await nowOr($)
    if (result.skip === undefined && t0 !== undefined && t1 !== undefined) {
      const u = result.usage
      addEvent(m.c, {
        k: 'compact',
        t0,
        t1,
        thread: threadOf(e.agentId),
        trigger: e.trigger,
        ...(result.tokensBefore !== undefined ? { before: result.tokensBefore } : {}),
        ...(result.tokensAfter !== undefined ? { after: result.tokensAfter } : {}),
        ...(u ? { usage: { in: u.input_tokens, out: u.output_tokens, cr: u.cache_read_input_tokens, cw: u.cache_creation_input_tokens } } : {}),
        stepsSeen: m.c.stepsInCompaction - stepsBefore,
      })
    }

    return result
  })

  // A main turn's end asks for the session's file at the next tick.
  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      m.turnEnded = true
    }
    return next(e)
  })

  // The session's file is written as it ends. A /clear goes on under a new session id with no session.start: the
  // next records start a file of their own.
  on('session.end', async ($, e, next) => {
    await flush($, m, settings)
    if (e.reason === 'clear') {
      m.c = newCollector()
      m.sid = undefined
      m.savedAt = undefined
      m.startedAt = (await nowOr($)) ?? 0
    }
    return next(e)
  })

  // /meter opens the pane, and closes it when it is open. Where no pane shows, the rows print as the command's output.
  on('command.run', { command: COMMAND }, async ($, e) => {
    const [sub, arg] = e.args.trim().split(/\s+/)
    if (sub === 'report') {
      return { text: await report($, m, settings, arg) }
    }
    if (sub !== undefined && sub !== '') {
      return { text: 'Usage: /meter opens or closes the pane; /meter report [days] adds up the sessions of the last days (7).' }
    }
    if ((await $.ui.panes()).some(p => p.id === PANE_ID)) {
      await $.ui.close({ id: PANE_ID })
      m.paneOpen = false
      return {}
    }
    const opened = await $.ui.open({ id: PANE_ID, title: 'oxen-meter', closeOnEscape: true, rows: 16 })
    m.paneOpen = opened.isPlaced
    if (opened.isPlaced) {
      return {}
    }

    return { text: rowsText(await rowsNow($, m, settings)) }
  })

  // Text alone, so the pane draws alike on a terminal and on the desktop.
  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE_ID) {
      return next(e)
    }
    const rows = await rowsNow($, m, settings)
    const labelW = Math.max(...rows.map(r => r.label.length))
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        {rows.map(r => (
          <Box key={r.label}>
            <Text color={COLORS.label} bold>{`${r.label.padEnd(labelW)}  `}</Text>
            <Text color={r.color ?? COLORS.detail}>{r.value}</Text>
          </Box>
        ))}
      </Box>
    )
  })
}
