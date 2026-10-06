// `setup codex|devin`: the hooks the CLI runs in Codex or Devin, added to ~/.codex/hooks.json or to the `hooks` of
// ~/.config/devin/config.json, beside the user's own. Without --write it prints what it would add; with it, after a
// yes, it keeps a backup and writes the merged file. It writes no other file: `hookConfigError` holds it to those two
// files and their backups.
import { realpathSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

import { readText, statOf } from './files.mjs'

/** A command the CLI put in a hook config: its own path, then `hook codex` or `hook devin`. */
const OURS = /oxen-meter\.mjs"? hook (codex|devin)\b/
export const BACKUP = '.oxen-meter.bak'

/** The files `setup` may write under `home`: Codex's hooks, Devin's config, and a backup of each. */
export const hookConfigs = home => {
  const files = [join(home, '.codex', 'hooks.json'), join(home, '.config', 'devin', 'config.json')]
  return [...files, ...files.map(f => `${f}${BACKUP}`)]
}

/** Why `setup` must not write `path`, or undefined when it may: one of `hookConfigs`, a plain file or none yet, in a folder there. */
export function hookConfigError(path, home) {
  if (!hookConfigs(home).includes(path)) {
    return `${path} is not a hook configuration oxen-meter writes.`
  }
  const dir = statOf(dirname(path))
  if (dir === undefined || dir.kind !== 'dir') {
    return `${dirname(path)} is not a folder: is the tool installed?`
  }
  const file = statOf(path)
  if (file === undefined) {
    return undefined
  }
  if (file.isLink || file.kind !== 'file') {
    return `${path} is a symbolic link or not a plain file.`
  }
  let real
  try {
    real = join(realpathSync(dirname(path)), basename(path))
  } catch {
    return `${path} cannot be resolved.`
  }
  return file.realPath === real ? undefined : `${path} lands on ${file.realPath}.`
}

/** The command a hook runs: this Node, this CLI, the tool, and the flags `setup` was given. */
export function hookCommand(node, cli, tool, flags = {}) {
  const q = s => `"${String(s).replace(/(["\\$`])/g, '\\$1')}"`
  const extra = [flags.data !== undefined ? ['--data', flags.data] : [], flags.claudeSettings !== undefined ? ['--claude-settings', flags.claudeSettings] : []].flat()

  return [q(node), q(cli), 'hook', tool, ...extra.map(q)].join(' ')
}

/**
 * Codex's hooks for `command`: the prompt and follow-up guard, quick and synchronous; the imports at a turn's,
 * a subagent's and a session's end, in the background where Codex can.
 */
export function codexHooks(command) {
  const now = { type: 'command', command, timeout: 10 }
  const later = { type: 'command', command, timeout: 120, async: true }

  return {
    UserPromptSubmit: [{ hooks: [now] }],
    PreToolUse: [{ matcher: '(followup_task|send_message)$', hooks: [now] }],
    Stop: [{ hooks: [later] }],
    SubagentStop: [{ hooks: [later] }],
    SessionEnd: [{ hooks: [later] }],
  }
}

/** Devin's hooks for `command`: the prompt guard, which only `ask` mode uses, and the imports at a turn's and a session's end. */
export function devinHooks(command) {
  const now = { type: 'command', command, timeout: 10 }
  const later = { type: 'command', command, timeout: 120 }

  return { UserPromptSubmit: [{ hooks: [now] }], Stop: [{ hooks: [later] }], SessionEnd: [{ hooks: [later] }] }
}

/** `config` (a hooks.json's value, or one with a `hooks` key) with the CLI's old hooks taken out and `ours` added. */
export function mergeHooks(config, ours) {
  const hooks = {}
  for (const [event, groups] of Object.entries(config?.hooks ?? {})) {
    const kept = (Array.isArray(groups) ? groups : [])
      .map(g => ({ ...g, hooks: (Array.isArray(g?.hooks) ? g.hooks : []).filter(h => !OURS.test(String(h?.command ?? ''))) }))
      .filter(g => g.hooks.length > 0)
    if (kept.length > 0) {
      hooks[event] = kept
    }
  }
  for (const [event, groups] of Object.entries(ours)) {
    hooks[event] = [...(hooks[event] ?? []), ...groups]
  }

  return { ...(config ?? {}), hooks }
}

/** The config file's value, `{}` when there is none yet, or undefined when it is not JSON (which `setup` never writes over). */
export function readConfig(path) {
  const text = readText(path)
  if (text === undefined || text.trim() === '') {
    return {}
  }
  try {
    const value = JSON.parse(text)
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined
  } catch {
    return undefined
  }
}
