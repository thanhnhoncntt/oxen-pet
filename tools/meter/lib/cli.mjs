// The CLI's commands, for tools/meter/oxen-meter.mjs, which loads this file once it can fail quietly.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { importCodex, summaryOptions } from './codex.mjs'
import { importDevin } from './devin.mjs'
import { configOf, saltOf } from './config.mjs'
import { readText, statOf, writeGuarded } from './files.mjs'
import { runHook } from './hook.mjs'
import { BACKUP, codexHooks, devinHooks, hookCommand, hookConfigError, mergeHooks, readConfig } from './setup.mjs'
import { analyze, dataPath, exportFile, project, report as reportModule, sessionFile, versionOf } from './plugin.mjs'

const DAY_MS = 86400000
const DAYS = { import: 30, report: 7, export: 30 }
const MAX_DAYS = 365
const USAGE = 'usage: node tools/meter/oxen-meter.mjs <import [days] | report [days] | export [days] | setup codex|devin [--write [--yes]] | hook codex|devin> [--data <folder>] [--codex-home <folder>] [--devin-home <folder>] [--claude-settings <file>]'

/** The days an argument asks for, else `fallback`. */
function daysOf(arg, fallback) {
  const asked = Number.parseInt(arg ?? '', 10)
  return Number.isFinite(asked) && asked > 0 ? Math.min(asked, MAX_DAYS) : fallback
}

/** Brings the data folder up to date with every tool the CLI reads. */
export async function importAll(o) {
  const codex = await importCodex(o)
  const devin = await importDevin(o)
  return { codex, devin }
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

const sessions = n => `${n} session${n === 1 ? '' : 's'} updated`
const busy = tool => `${tool}: another import is running; this reads what is already in.`

function importLine(r) {
  const c = r.codex
  const d = r.devin
  const codex = c === undefined ? busy('Codex') : `Codex: ${c.files} file${c.files === 1 ? '' : 's'} read (${(c.bytes / 1e6).toFixed(1)} MB), ${sessions(c.sessions.length)}.`
  const devin = d === undefined ? busy('Devin') : d.none ? '' : ` Devin: ${sessions(d.sessions.length)}.`

  return `${codex}${devin}`
}

/** Writes a hook config through `hookConfigError`. */
function writeHookConfig(path, text, home) {
  const error = hookConfigError(path, home)
  if (error !== undefined) {
    throw new Error(error)
  }
  writeFileSync(path, text)
}

const TRUST = {
  codex: 'Codex runs a new hook only once you trust it: open Codex and run /hooks to review them.',
  devin: 'Devin loads them in its next session; /hooks there lists them. Devin shows no message from a hook, so only Cold resume guard set to ask holds a prompt back, once, before a cold resume.',
}

/** `setup codex|devin`: prints the hooks it would add, or with --write, after a yes, adds them with a backup. */
async function setup(tool, flags, config) {
  if (tool !== 'codex' && tool !== 'devin') {
    return { code: 1, text: USAGE }
  }
  const path = tool === 'codex' ? join(config.home, '.codex', 'hooks.json') : join(config.home, '.config', 'devin', 'config.json')
  const command = hookCommand(process.execPath, fileURLToPath(new URL('../oxen-meter.mjs', import.meta.url)), tool, flags)
  const ours = tool === 'codex' ? codexHooks(command) : devinHooks(command)
  const current = readConfig(path)
  if (current === undefined) {
    return { code: 1, text: `${path} is not JSON: fix it or move it, then run setup again.` }
  }
  const error = hookConfigError(path, config.home) ?? hookConfigError(`${path}${BACKUP}`, config.home)
  if (error !== undefined) {
    return { code: 1, text: error }
  }
  const shown = `${JSON.stringify(ours, null, 2)}\n\nEach runs ${process.execPath}: after you upgrade Node, run setup again.`
  if (!flags.write) {
    return { code: 0, text: `oxen-meter would add these hooks to ${path}, beside yours:\n${shown}\nRun again with --write to add them.` }
  }
  if (!flags.yes) {
    if (!process.stdin.isTTY) {
      return { code: 1, text: 'Not asked: no terminal to answer. Run again with --write --yes to add the hooks.' }
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    const answer = await rl.question(`Add oxen-meter's hooks to ${path}? A backup goes to ${path}${BACKUP}. [y/N] `)
    rl.close()
    if (!/^y(es)?$/i.test(answer.trim())) {
      return { code: 0, text: 'Nothing written.' }
    }
  }
  if (existsSync(path)) {
    writeHookConfig(`${path}${BACKUP}`, readFileSync(path, 'utf8'), config.home)
  }
  writeHookConfig(path, `${JSON.stringify(mergeHooks(current, ours), null, 2)}\n`, config.home)

  return { code: 0, text: `Added oxen-meter's hooks to ${path}${existsSync(`${path}${BACKUP}`) ? ` (the old file is in ${path}${BACKUP})` : ''}. ${TRUST[tool]}\nEach runs ${process.execPath}: after you upgrade Node, run setup again.` }
}

/** Runs one command; resolves to what it prints. */
export async function run(argv, flags = {}) {
  const [command, arg] = argv
  if (command !== 'hook' && command !== 'setup' && !(command in DAYS)) {
    return { code: 1, text: USAGE }
  }
  const config = configOf(flags)
  if (command === 'setup') {
    return setup(arg, flags, config)
  }
  if (command === 'hook') {
    // A hook never fails the tool that runs it: whatever goes wrong, it prints nothing and exits 0.
    try {
      if ((arg !== 'codex' && arg !== 'devin') || config.root === undefined) {
        return { code: 0, text: '' }
      }
      const input = flags.input ?? readFileSync(0, 'utf8')
      return { code: 0, text: await runHook(arg, input, { ...config, now: flags.now ?? Date.now(), days: config.settings.retentionDays, salt: saltOf(config.root) }) }
    } catch {
      return { code: 0, text: '' }
    }
  }
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
  const switches = { '--write': 'write', '--yes': 'yes' }
  for (let i = 0; i < argv.length; i++) {
    const name = names[argv[i]]
    if (name !== undefined) {
      flags[name] = resolve(argv[++i] ?? '')
    } else if (switches[argv[i]] !== undefined) {
      flags[switches[argv[i]]] = true
    } else {
      rest.push(argv[i])
    }
  }
  return { rest, flags }
}

