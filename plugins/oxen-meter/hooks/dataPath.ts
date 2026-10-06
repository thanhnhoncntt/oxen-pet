import type { FsStat } from 'claude-code'

/**
 * Where the meter may write: its data folder's `sessions/<session id>.json`, `exports/oxen-meter-export-….json`, and
 * `state/salt.json`, the salt the mod and the CLI share; the CLI (`tools/meter`) also its `state/codex|devin.json|lock`.
 * Nothing else. Every write goes through `dataPathError` (the spelling) and `dataTargetError` (where the path leads on
 * disk). The data folder's own ancestors may be links (a `.claude` folder kept in a dotfiles repo); from the data folder
 * down, nothing may be.
 */

export type DataKind = 'sessions' | 'exports' | 'salt' | 'import'

const SESSION_NAME = /^[A-Za-z0-9-]{8,64}\.json$/
const EXPORT_NAME = /^oxen-meter-export-\d{8}(?:-[a-z0-9-]{1,32})?\.json$/
const KINDS: Record<DataKind, { folder: string; name: RegExp }> = {
  sessions: { folder: 'sessions', name: SESSION_NAME },
  exports: { folder: 'exports', name: EXPORT_NAME },
  salt: { folder: 'state', name: /^salt\.json$/ },
  import: { folder: 'state', name: /^(codex|devin)\.(json|lock)$/ },
}
/** What the mod writes: its sessions, its exports, and the salt it shares with the CLI. */
export const MOD_KINDS: readonly DataKind[] = ['sessions', 'exports', 'salt']
/** What the CLI writes: the same, and the state of its imports with their locks. */
export const CLI_KINDS: readonly DataKind[] = [...MOD_KINDS, 'import']

const isAbsolute = (p: string) => p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p)
const hasDotDot = (p: string) => p.split(/[\\/]/).includes('..')
/** A path with `/` for every separator and no trailing one, so spellings from different calls compare. */
const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')

/** The data folder: the setting's, when it is an absolute path with no `..`, `~` or `$`; else oxen-meter in the `.claude` folder the plugin is installed under. */
export function dataRootOf(pluginRoot: string, setting: string): string | undefined {
  const asked = setting.trim()
  if (asked !== '' && isAbsolute(asked) && !hasDotDot(asked) && !/[$~]/.test(asked)) {
    return asked.replace(/[\\/]+$/, '')
  }
  const at = pluginRoot.search(/[\\/]\.claude[\\/]/)

  return at < 0 ? undefined : `${pluginRoot.slice(0, at + '/.claude'.length)}/oxen-meter`
}

export const sessionPath = (root: string, sid: string) => `${root}/sessions/${sid}.json`
export const saltPath = (root: string) => `${root}/state/salt.json`
export const statePath = (root: string, tool: 'codex' | 'devin', ext: 'json' | 'lock') => `${root}/state/${tool}.${ext}`

/** The export file of `day` (YYYYMMDD), with the user's label made safe for a file name. */
export function exportPath(root: string, day: string, label: string) {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    .replace(/-+$/, '')

  return `${root}/exports/oxen-meter-export-${day}${slug ? `-${slug}` : ''}.json`
}

/** Why the meter must not write `path`, by its spelling alone, or undefined when it may: one of `kinds`, the mod's by default. */
export function dataPathError(root: string, path: unknown, kinds: readonly DataKind[] = MOD_KINDS): string | undefined {
  if (typeof path !== 'string' || path === '') {
    return 'no path.'
  }
  if (!isAbsolute(root) || !isAbsolute(path) || hasDotDot(root) || hasDotDot(path)) {
    return 'the path must be absolute, with no `..`.'
  }
  for (const kind of kinds) {
    const folder = `${norm(root)}/${KINDS[kind].folder}/`
    const p = norm(path)
    if (p.startsWith(folder) && KINDS[kind].name.test(p.slice(folder.length))) {
      return undefined
    }
  }

  return `${path} is not a file the meter writes in ${root}.`
}

/** What is on disk along an allowed path: its data folder's parent, the data folder, the kind folder and the file, each undefined when missing. */
export type TargetStats = { parent?: FsStat; root?: FsStat; dir?: FsStat; file?: FsStat }

const landsOn = (s: FsStat) => `the path lands on ${s.realPath ?? 'a place that cannot be resolved'}.`

/**
 * Why the meter must not write `path` (already through `dataPathError`) where it leads, or undefined when it may.
 * Missing folders may be created, the data folder only inside a folder that exists.
 */
export function dataTargetError(path: string, s: TargetStats): string | undefined {
  const parts = norm(path).split('/')
  const name = parts.at(-1) ?? ''
  const kind = parts.at(-2) ?? ''
  if (s.root === undefined) {
    return s.parent?.kind === 'dir' ? undefined : "the data folder's parent must already be a folder."
  }
  if (s.root.isLink) {
    return 'the data folder is a symbolic link.'
  }
  if (s.root.kind !== 'dir' || s.root.realPath === undefined) {
    return s.root.kind !== 'dir' ? 'the data folder is not a folder.' : landsOn(s.root)
  }
  if (s.dir === undefined) {
    return undefined
  }
  if (s.dir.isLink) {
    return `the ${kind} folder is a symbolic link.`
  }
  if (s.dir.kind !== 'dir') {
    return `the ${kind} folder is not a folder.`
  }
  if (s.dir.realPath === undefined || norm(s.dir.realPath) !== `${norm(s.root.realPath)}/${kind}`) {
    return landsOn(s.dir)
  }
  if (s.file === undefined) {
    return undefined
  }
  if (s.file.isLink) {
    return 'the file is a symbolic link.'
  }
  if (s.file.kind !== 'file') {
    return 'the path is not a plain file.'
  }
  if (s.file.realPath === undefined || norm(s.file.realPath) !== `${norm(s.dir.realPath)}/${name}`) {
    return landsOn(s.file)
  }

  return undefined
}
