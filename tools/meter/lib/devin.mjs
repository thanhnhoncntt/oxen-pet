// Devin CLI's sessions into the data folder: each session changed since the last import is read again whole from
// Devin's database, opened read-only, and written as `sessions/devin-<session id>.json`. The query takes each node's
// metadata out with SQLite's json_extract, so a message's text never reaches this process.
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { summaryOptions } from './codex.mjs'
import { readJson, readText, withLock, writeGuarded } from './files.mjs'
import { dataPath, devinLog, project, record, sessionFile, versionOf } from './plugin.mjs'

const DAY_MS = 86400000
const STATE_VERSION = 1
const SESSION_ID = /^[A-Za-z0-9-]{8,57}$/

const NODES = `
  select node_id as node, parent_node_id as parent,
    json_extract(chat_message, '$.role') as role,
    json_extract(chat_message, '$.metadata.request_id') as req,
    json_extract(chat_message, '$.metadata.generation_model') as model,
    json_extract(chat_message, '$.metadata.started_generation_at') as t0,
    json_extract(chat_message, '$.metadata.created_at') as t1,
    json_extract(chat_message, '$.metadata.query_label') as label,
    json_extract(chat_message, '$.metadata.metrics.input_tokens') as inp,
    json_extract(chat_message, '$.metadata.metrics.cache_read_tokens') as cr,
    json_extract(chat_message, '$.metadata.metrics.cache_creation_tokens') as cw,
    json_extract(chat_message, '$.metadata.metrics.output_tokens') as out,
    (select group_concat(json_extract(value, '$.name')) from json_each(chat_message, '$.tool_calls')) as tools,
    json_extract(chat_message, '$.metadata.extensions."subagent/agent_id"') as agent,
    json_extract(chat_message, '$.metadata.extensions."subagent/profile_name"') as profile,
    json_extract(chat_message, '$.metadata.is_user_input') as user
  from message_nodes where session_id = ? order by row_id`

/** Devin's database, read-only; undefined when there is none. */
export async function openDevin(devinHome) {
  const path = join(devinHome, 'sessions.db')
  if (!existsSync(path)) {
    return undefined
  }
  // Loaded only when Devin is there; lib/quiet.mjs keeps its experimental-feature warning off the output.
  const { DatabaseSync } = await import('node:sqlite')
  return new DatabaseSync(path, { readOnly: true })
}

/**
 * Reads the sessions active in the last `days` that changed since the last import, and writes each again whole.
 * `only`, when given, reads that session alone (a hook names its own). Holds the Devin lock; resolves to undefined
 * when another import holds it.
 */
export async function importDevin(o) {
  const db = await openDevin(o.devinHome)
  if (db === undefined) {
    return { sessions: [], none: true }
  }
  try {
    return await withLock(o.root, 'devin', o.now, async () => {
      const statePath = dataPath.statePath(o.root, 'devin', 'json')
      const saved = readJson(statePath)
      const state = saved?.v === STATE_VERSION && saved.sessions !== null && typeof saved.sessions === 'object' ? saved : { v: STATE_VERSION, sessions: {} }
      const since = o.now - Math.min(o.days, o.settings.retentionDays) * DAY_MS
      const list = db.prepare('select id, working_directory as cwd, created_at as createdAt, last_activity_at as activeAt from sessions').all()
      const written = []
      for (const s of list) {
        const active = Number(s.activeAt) < 1e12 ? Number(s.activeAt) * 1000 : Number(s.activeAt)
        if ((o.only !== undefined && s.id !== o.only) || active < since || state.sessions[s.id] === s.activeAt) {
          continue
        }
        const rows = db.prepare(NODES).all(s.id)
        const records = devinLog.devinRecords(rows)
        const c = record.newCollector()
        devinLog.applyDevin(c, records)
        const sid = `devin-${SESSION_ID.test(s.id) ? s.id : await project.shortHash(o.salt, s.id)}`
        const path = dataPath.sessionPath(o.root, sid)
        const existing = sessionFile.readSessionText(readText(path) ?? '')
        const first = Math.min(...records.steps.map(r => r.t0), ...records.events.map(e => ('t' in e ? e.t : e.t0)))
        const meta = {
          sid,
          tool: 'devin',
          project: existing?.project ?? (typeof s.cwd === 'string' && s.cwd !== '' ? await project.projectLabel(s.cwd, o.salt, o.settings.hashProject) : ''),
          startedAt: Number.isFinite(first) ? first : active,
          savedAt: o.now,
          version: versionOf(),
          settings: summaryOptions(o.settings),
        }
        writeGuarded(o.root, path, sessionFile.sessionText(c, meta))
        state.sessions[s.id] = s.activeAt
        written.push(sid)
      }
      writeGuarded(o.root, statePath, JSON.stringify(state))

      return { sessions: written }
    })
  } finally {
    db.close()
  }
}
