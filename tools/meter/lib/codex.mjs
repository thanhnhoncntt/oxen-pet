// Codex CLI's rollout files into the data folder: each session (its main thread's file and its subagents') as one
// session file, `sessions/codex-<session id>.json`, read on from where the last import stopped.
import { statSync } from 'node:fs'
import { join } from 'node:path'

import { filesUnder, linesFrom, readJson, readText, withLock, writeGuarded } from './files.mjs'
import { codexLog, dataPath, project, record, sessionFile, versionOf } from './plugin.mjs'

const DAY_MS = 86400000
const STATE_VERSION = 1
const SESSION_ID = /^[A-Za-z0-9-]{8,57}$/

/** The settings a session file keeps, as the mod's do. */
export const summaryOptions = s => ({ mainTtl: s.mainTtl, subagentTtl: s.subagentTtl, coldTokens: s.coldTokens, outputWeight: s.outputWeight, cachedWeight: s.cachedWeight })

/** The session file's id: `codex-` and Codex's session id, or a hash of an id that does not fit a file name. */
async function sidOf(session, salt) {
  return `codex-${SESSION_ID.test(session) ? session : await project.shortHash(salt, session)}`
}

/** Adds `ops`, read from a session's files, to its session file: the file as it was, plus what is new. */
async function writeSession(o, session, ops, salt) {
  const sid = await sidOf(session, salt)
  const path = dataPath.sessionPath(o.root, sid)
  const existing = sessionFile.readSessionText(readText(path) ?? '')
  const c = existing ? sessionFile.restoreCollector(existing) : record.newCollector()
  codexLog.applyCodexOps(c, ops)
  codexLog.resolveCodex(c, { coldAfterMin: o.settings.coldAfterMin, coldTokens: o.settings.coldTokens })
  // The hooks' runs for this session, each timed by the hook itself (lib/hook.mjs keeps them).
  c.timings = structuredClone(o.guard?.timings?.[session] ?? {})
  const metas = ops.filter(op => op.op === 'meta')
  const cwd = (metas.find(m => m.thread === m.session) ?? metas[0])?.cwd
  const firstT = Math.min(...metas.map(m => m.t), ...c.records.map(r => ('t' in r ? r.t : r.t0)))
  const meta = {
    sid,
    tool: 'codex',
    project: existing?.project ?? (cwd === undefined ? '' : await project.projectLabel(cwd, salt, o.settings.hashProject)),
    startedAt: existing?.startedAt ?? (Number.isFinite(firstT) ? firstT : o.now),
    savedAt: o.now,
    version: versionOf(),
    settings: summaryOptions(o.settings),
  }
  writeGuarded(o.root, path, sessionFile.sessionText(c, meta))

  return sid
}

/**
 * Reads the rollout files changed in the last `days` from where the last import stopped, and adds what they hold to
 * their sessions' files. `only`, when given, reads that one file alone (a hook names its own). Holds the Codex lock;
 * resolves to undefined when another import holds it.
 */
export async function importCodex(o) {
  const dir = join(o.codexHome, 'sessions')
  const since = o.now - Math.min(o.days, o.settings.retentionDays) * DAY_MS
  return withLock(o.root, 'codex', o.now, async () => {
    const statePath = dataPath.statePath(o.root, 'codex', 'json')
    const saved = readJson(statePath)
    const state = saved?.v === STATE_VERSION && saved.files !== null && typeof saved.files === 'object' ? saved : { v: STATE_VERSION, files: {} }
    const names = o.only !== undefined ? [o.only] : filesUnder(dir, n => n.startsWith('rollout-') && n.endsWith('.jsonl'))
    const touched = new Map()
    let bytes = 0
    let read = 0
    for (const rel of names) {
      let st
      try {
        st = statSync(join(dir, rel))
      } catch {
        continue
      }
      const known = state.files[rel]
      if (st.mtimeMs < since || (known !== undefined && known.size === st.size)) {
        continue
      }
      // A file shorter than where the last read stopped was written over: it is read again from the start.
      const fresh = known === undefined || st.size < known.offset
      const parser = fresh ? codexLog.newCodexState() : known.parser
      const from = fresh ? 0 : known.offset
      const ops = []
      let end = from
      for (const { line, end: after } of linesFrom(join(dir, rel), from, st.size)) {
        ops.push(...codexLog.codexLine(parser, line, { mode: o.settings.resumeGuard }))
        end = after
      }
      bytes += end - from
      read += 1
      const session = parser.own?.session
      state.files[rel] = { size: st.size, offset: end, parser, ...(session !== undefined ? { session } : {}) }
      if (session !== undefined && ops.length > 0) {
        touched.set(session, [...(touched.get(session) ?? []), ...ops])
      }
    }
    const sessions = []
    const guard = readJson(dataPath.statePath(o.root, 'codex', 'guard.json'))
    for (const [session, ops] of touched) {
      sessions.push(await writeSession({ ...o, guard }, session, ops, o.salt))
    }
    writeGuarded(o.root, statePath, JSON.stringify(state))

    return { files: read, bytes, sessions }
  })
}
