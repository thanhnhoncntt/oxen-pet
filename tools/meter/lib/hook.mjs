// The CLI as a Codex hook: `node oxen-meter.mjs hook codex`, with the event's JSON on stdin. It imports the thread
// that just stopped, warns before a prompt or a follow-up resumes a thread whose cache is likely gone, and in `ask` mode
// holds a prompt back once. It answers with one JSON object or nothing, and exits 0 whatever happens: a failing hook
// must never stop the user's work.
import { closeSync, fstatSync, openSync, readSync } from 'node:fs'

import { importCodex } from './codex.mjs'
import { readJson, readText, writeGuarded } from './files.mjs'
import { codexLog, dataPath, hookGuard, record, report, sessionFile, timing } from './plugin.mjs'

const TAIL_BYTES = 512 * 1024
const FOLLOW_UP = /(followup_task|send_message)$/
const GUARD_VERSION = 1
const DAY_MS = 86400000

/** The complete lines in the last `bytes` of a file. */
function tailLines(path, bytes = TAIL_BYTES) {
  const fd = openSync(path, 'r')
  try {
    const size = fstatSync(fd).size
    const from = Math.max(0, size - bytes)
    const buf = Buffer.alloc(size - from)
    readSync(fd, buf, 0, buf.length, from)
    const lines = buf.toString('utf8').split('\n')
    if (from > 0) {
      lines.shift()
    }
    return lines.filter(Boolean)
  } catch {
    return []
  } finally {
    closeSync(fd)
  }
}

/** The main thread's last request in a rollout's tail: when it went, its context and model. */
export function lastRequest(path) {
  const state = codexLog.newCodexState()
  let last
  const take = ops => {
    for (const op of ops) {
      if (op.op === 'step' && op.record.thread === record.MAIN) {
        last = op.record
      }
    }
  }
  for (const line of tailLines(path)) {
    take(codexLog.codexLine(state, line))
  }
  take(codexLog.codexEnd(state))

  return last === undefined ? undefined : { t0: last.t0, ctx: last.ctx, model: last.model }
}

/** Codex's home folder and the rollout's path under its sessions folder, from a rollout's absolute path. */
function rolloutOf(path) {
  const at = typeof path === 'string' ? path.lastIndexOf('/sessions/') : -1
  return at < 0 ? undefined : { codexHome: path.slice(0, at), rel: path.slice(at + '/sessions/'.length) }
}

/** The last step of `thread` in the session's file, as the last import left it. */
function lastStepOf(file, thread) {
  let last
  for (const r of file.records) {
    if (r.k === 'step' && r.thread === thread && (last === undefined || r.t0 > last.t0)) {
      last = r
    }
  }
  return last
}

/** What the hook answers to `e`, and does: imports, and the guard's notes of what it held back. */
async function answerOf(e, o, guard) {
  const event = e.hook_event_name
  const session = typeof e.session_id === 'string' ? e.session_id : ''
  if (event === 'Stop' || event === 'SessionEnd' || event === 'SubagentStop') {
    const rollout = rolloutOf(event === 'SubagentStop' ? e.agent_transcript_path : e.transcript_path)
    if (rollout !== undefined) {
      await importCodex({ ...o, codexHome: rollout.codexHome, only: rollout.rel, days: o.settings.retentionDays })
    }
    return undefined
  }
  const guardOptions = { coldAfterMin: o.settings.coldAfterMin, coldTokens: o.settings.coldTokens, cachedWeight: o.settings.cachedWeight, tool: 'codex' }
  if (event === 'UserPromptSubmit' && e.agent_id === undefined && typeof e.transcript_path === 'string') {
    const last = lastRequest(e.transcript_path)
    const risk = hookGuard.idleRisk(last, o.now, guardOptions)
    const answer = hookGuard.promptAnswer(risk, o.settings.resumeGuard, risk !== undefined && guard.asked[session] === last.t0)
    if (answer !== undefined && 'decision' in answer) {
      guard.asked[session] = last.t0
    }
    return answer
  }
  if (event === 'PreToolUse' && FOLLOW_UP.test(String(e.tool_name)) && typeof e.tool_input?.target === 'string') {
    const file = sessionFile.readSessionText(readText(dataPath.sessionPath(o.root, `codex-${session}`)) ?? '')
    // A target is a path, or a name relative to the calling thread's own path.
    const from = typeof e.agent_id === 'string' ? Object.entries(file?.names ?? {}).find(([, id]) => id === e.agent_id)?.[0] : codexLog.ROOT_PATH
    const thread = from === undefined ? undefined : file?.names[codexLog.agentPathOf(from, e.tool_input.target)]
    if (file === undefined || thread === undefined || thread === record.MAIN || thread === e.agent_id) {
      return undefined
    }
    const last = lastStepOf(file, thread)
    const label = report.agentLabel(thread, last?.agentType)
    return hookGuard.followUpWarning(hookGuard.idleRisk(last, o.now, guardOptions), o.settings.resumeGuard, label)
  }
  return undefined
}

/**
 * Runs the Codex hook for the event `input` (stdin's text); resolves to what it prints, or '' for nothing. Its own
 * time, from Node's start, goes with the session for the report.
 */
export async function codexHook(input, o) {
  let e
  try {
    e = JSON.parse(input)
  } catch {
    return ''
  }
  const guardPath = dataPath.statePath(o.root, 'codex', 'guard.json')
  const saved = readJson(guardPath)
  const guard = saved?.v === GUARD_VERSION ? { asked: saved.asked ?? {}, timings: saved.timings ?? {}, seen: saved.seen ?? {} } : { asked: {}, timings: {}, seen: {} }
  let answer
  try {
    answer = await answerOf(e, o, guard)
  } catch {
    answer = undefined
  }
  const session = typeof e.session_id === 'string' ? e.session_id : ''
  if (session !== '') {
    timing.noteTiming((guard.timings[session] ??= {}), `codex ${e.hook_event_name}`, performance.now())
    guard.seen[session] = o.now
  }
  // Sessions not seen for the retention days leave the guard's notes.
  for (const [s, at] of Object.entries(guard.seen)) {
    if (o.now - at > o.settings.retentionDays * DAY_MS) {
      delete guard.seen[s]
      delete guard.asked[s]
      delete guard.timings[s]
    }
  }
  try {
    writeGuarded(o.root, guardPath, JSON.stringify({ v: GUARD_VERSION, ...guard }))
  } catch {
    // The notes wait for the next run.
  }

  return answer === undefined ? '' : JSON.stringify(answer)
}
