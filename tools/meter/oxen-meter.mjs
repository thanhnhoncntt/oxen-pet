#!/usr/bin/env node
// oxen-meter's command line, for the tools a Claude Code mod cannot reach: it imports Codex CLI's (and Devin CLI's)
// sessions into the meter's data folder, prints the report over every tool, and writes the export for the team.
// Run: node tools/meter/oxen-meter.mjs <import [days] | report [days] | export [days]> [--data <folder>]
//        [--codex-home <folder>] [--devin-home <folder>] [--claude-settings <file>]
// Needs Node 22.18 or later. It reads the files named below and writes only to the data folder, through the mod's guard;
// it makes no network request and starts no process. See SECURITY-AUDIT.md.
import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { importCodex } from './lib/codex.mjs'
import { configOf, saltOf } from './lib/config.mjs'
import { readText, statOf, writeGuarded } from './lib/files.mjs'
import { analyze, dataPath, exportFile, project, report as reportModule, sessionFile, versionOf } from './lib/plugin.mjs'
import { summaryOptions } from './lib/codex.mjs'

const DAY_MS = 86400000
const DAYS = { import: 30, report: 7, export: 30 }
const MAX_DAYS = 365
const USAGE = 'usage: node tools/meter/oxen-meter.mjs <import [days] | report [days] | export [days]> [--data <folder>] [--codex-home <folder>] [--devin-home <folder>] [--claude-settings <file>]'

/** The days an argument asks for, else `fallback`. */
function daysOf(arg, fallback) {
  const asked = Number.parseInt(arg ?? '', 10)
  return Number.isFinite(asked) && asked > 0 ? Math.min(asked, MAX_DAYS) : fallback
}

/** Brings the data folder up to date with every tool the CLI reads. */
export async function importAll(o) {
  const codex = await importCodex(o)
  return { codex }
}

/** The session files written in the last `days`, and how many were emptied. */
export function readSessions(root, now, days) {
  const dir = `${root}/sessions`
  const files = []
  let skipped = 0
  let names = []
  try {
    names = readdirSync(dir)
  } catch {
    return { files, skipped }
  }
  for (const name of names.filter(n => n.endsWith('.json'))) {
    const st = statOf(`${dir}/${name}`)
    if (st === undefined || st.kind !== 'file' || st.isLink || now - st.mtimeMs > days * DAY_MS) {
      continue
    }
    const text = readText(`${dir}/${name}`) ?? ''
    const file = sessionFile.readSessionText(text)
    if (file && now - sessionFile.activeAt(file) <= days * DAY_MS) {
      files.push(file)
    } else if (text.trim() === sessionFile.TOMBSTONE) {
      skipped += 1
    }
  }

  return { files, skipped }
}

const sessionData = f => ({ sid: f.sid, startedAt: f.startedAt, records: f.records, groups: f.groups, ...(f.tool !== undefined ? { tool: f.tool } : {}) })

function importLine(r) {
  const c = r.codex
  if (c === undefined) {
    return 'Codex: another import is running; this report reads what is already in.'
  }
  return `Codex: ${c.files} file${c.files === 1 ? '' : 's'} read (${(c.bytes / 1e6).toFixed(1)} MB), ${c.sessions.length} session${c.sessions.length === 1 ? '' : 's'} updated.`
}

/** Runs one command; resolves to what it prints. */
export async function run(argv, flags = {}) {
  const [command, arg] = argv
  if (!(command in DAYS)) {
    return { code: 1, text: USAGE }
  }
  const config = configOf(flags)
  if (config.root === undefined) {
    return { code: 1, text: 'No data folder: set Data folder in /plugin configure oxen-meter@oxen-pet, or pass --data.' }
  }
  const now = flags.now ?? Date.now()
  const days = daysOf(arg, DAYS[command])
  const salt = saltOf(config.root)
  const o = { ...config, now, days, salt }
  const imported = await importAll(o)
  if (command === 'import') {
    return { code: 0, text: importLine(imported) }
  }
  const { files, skipped } = readSessions(config.root, now, days)
  if (command === 'report') {
    return { code: 0, text: `${importLine(imported)}\n${reportModule.reportText(analyze.summarize(files.map(sessionData), config.settings), { days, skipped })}` }
  }
  const sessions = await Promise.all(files.map(async file => ({ file, id: await project.shortHash(salt, file.sid) })))
  const day = new Date(now).toISOString().slice(0, 10)
  const path = dataPath.exportPath(config.root, day.replace(/-/g, ''), config.settings.userLabel)
  writeGuarded(config.root, path, exportFile.exportText(exportFile.exportOf(sessions, { label: config.settings.userLabel, version: versionOf(), day, days, settings: summaryOptions(config.settings) })))

  return { code: 0, text: `${importLine(imported)}\nWrote ${sessions.length} session${sessions.length === 1 ? '' : 's'} of the last ${days} days to ${path}. Send that file to whoever builds the team report.` }
}

/** The command and its flags from the command line. */
export function argsOf(argv) {
  const flags = {}
  const rest = []
  const names = { '--data': 'data', '--codex-home': 'codexHome', '--devin-home': 'devinHome', '--claude-settings': 'claudeSettings' }
  for (let i = 0; i < argv.length; i++) {
    const name = names[argv[i]]
    if (name !== undefined) {
      flags[name] = resolve(argv[++i] ?? '')
    } else {
      rest.push(argv[i])
    }
  }
  return { rest, flags }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { rest, flags } = argsOf(process.argv.slice(2))
  try {
    const out = await run(rest, flags)
    ;(out.code === 0 ? console.log : console.error)(out.text)
    process.exitCode = out.code
  } catch (err) {
    console.error(`oxen-meter: ${err instanceof Error ? err.message : String(err)}`)
    process.exitCode = 1
  }
}
