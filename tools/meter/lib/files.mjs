// The CLI's file system: what the guard reads of a path, the one way it writes, its locks, and a reader that goes
// through a file of any size a line at a time from where it last stopped.
import { closeSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, realpathSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { dataPath } from './plugin.mjs'

const CHUNK = 4 * 1024 * 1024
/** A lock older than this was left by a run that died: the next run takes it over. */
export const LOCK_STALE_MS = 60000

/** What the guard reads of `path`, as Claude Code's `$.fs.stat` with `resolve` gives it; undefined when nothing is there. */
export function statOf(path) {
  let link
  try {
    link = lstatSync(path)
  } catch {
    return undefined
  }
  let target
  let realPath
  try {
    target = statSync(path)
    realPath = realpathSync(path)
  } catch {
    // A link that leads nowhere: it has no kind and no real path.
  }
  const kind = target === undefined ? 'other' : target.isDirectory() ? 'dir' : target.isFile() ? 'file' : 'other'

  return { kind, size: target?.size ?? 0, mtimeMs: target?.mtimeMs ?? 0, isLink: link.isSymbolicLink(), ...(realPath !== undefined ? { realPath } : {}) }
}

/** Why the CLI must not write `path` in the data folder `root`, or undefined when it may: the mod's guard, with the CLI's kinds. */
export function guardError(root, path) {
  return dataPath.dataPathError(root, path, dataPath.CLI_KINDS) ?? dataPath.dataTargetError(path, { parent: statOf(dirname(root)), root: statOf(root), dir: statOf(dirname(path)), file: statOf(path) })
}

/** Writes `text` to `path` once the guard allows it; throws the guard's reason when it does not. */
export function writeGuarded(root, path, text, flag = 'w') {
  const error = guardError(root, path)
  if (error !== undefined) {
    throw new Error(error)
  }
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text, { flag })
}

/** A file's text, or undefined when it cannot be read. */
export function readText(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
}

/** A JSON file's value, or undefined when it is missing or not JSON. */
export function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
}

/**
 * Runs `fn` holding `tool`'s lock in the data folder, so two runs (two hooks at once) never write the same files;
 * resolves to undefined, running nothing, while another run holds it.
 */
export async function withLock(root, tool, now, fn) {
  const path = dataPath.statePath(root, tool, 'lock')
  try {
    writeGuarded(root, path, String(now), 'wx')
  } catch (err) {
    if (err?.code !== 'EEXIST') {
      throw err
    }
    const held = statOf(path)
    if (held !== undefined && now - held.mtimeMs < LOCK_STALE_MS) {
      return undefined
    }
    writeGuarded(root, path, String(now))
  }
  try {
    return await fn()
  } finally {
    try {
      unlinkSync(path)
    } catch {
      // The next run takes a stale lock over.
    }
  }
}

/** The complete lines of `path` from byte `offset` up to `size`, each with the byte after it; a last line with no newline waits. */
export function* linesFrom(path, offset, size) {
  const fd = openSync(path, 'r')
  try {
    const buf = Buffer.alloc(CHUNK)
    let pos = offset
    let carry = Buffer.alloc(0)
    while (pos < size) {
      const n = readSync(fd, buf, 0, Math.min(CHUNK, size - pos), pos)
      if (n <= 0) {
        break
      }
      pos += n
      const data = carry.length > 0 ? Buffer.concat([carry, buf.subarray(0, n)]) : buf.subarray(0, n)
      const base = pos - data.length
      let start = 0
      for (let i = data.indexOf(10); i >= 0; i = data.indexOf(10, start)) {
        yield { line: data.toString('utf8', start, i), end: base + i + 1 }
        start = i + 1
      }
      carry = Buffer.from(data.subarray(start))
    }
  } finally {
    closeSync(fd)
  }
}

/** The files under `dir` whose names `keep` takes, as paths relative to it, depth first; a folder that cannot be read has none. */
export function filesUnder(dir, keep, rel = '') {
  let entries
  try {
    entries = readdirSync(join(dir, rel), { withFileTypes: true })
  } catch {
    return []
  }
  return entries.flatMap(e => (e.isDirectory() ? filesUnder(dir, keep, join(rel, e.name)) : e.isFile() && keep(e.name) ? [join(rel, e.name)] : []))
}
