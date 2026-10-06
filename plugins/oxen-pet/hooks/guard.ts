/**
 * The shield: which Bash commands destroy work, and what to tell the user before one runs. Pure, so the hooks in
 * register.tsx only ask and answer. A false alarm costs one question; a missed command costs work, so a command
 * that only mentions a risky word (`echo "rm -rf"`) is asked about too.
 */

/** One path a command deletes: `unsized` when its spelling (a glob, a variable, `~`, a path after `cd`) names no file the mod can look at. */
export type Target = { path: string; unsized?: true }
/** What a risky command does, in a few words each, and the paths it deletes when it names them. */
export type Risk = { what: string[]; targets: Target[] }
/** How many files a target holds: at least `files` when capped; `isMissing` when nothing is there. */
export type Size = { files: number; isCapped?: true; isMissing?: true }
/** The two calls `sizeOf` needs, which register.tsx answers with `$.fs`. */
export type GuardFs = {
  stat: (path: string) => Promise<{ kind: string; isLink: boolean }>
  list: (path: string) => Promise<{ name: string; kind: string; isLink: boolean }[]>
}

export const GUARD_CAP = 2000 // files counted per target before the count reads `2000+`
const GUARD_DEPTH = 8 // folders deep the count goes
const GUARD_DIRS = 300 // folders listed per target
const MAX_COMMAND = 80
const MAX_PATH = 40
const MAX_TARGETS = 4

/** The two answers, block first, so a dialog that answers for an absent user picks it. */
export const GUARD_OPTIONS = { block: 'Block it', run: 'Run it' } as const

const DELETES = 'deletes files and folders for good'

/** The command split where the shell splits it into commands: `&&`, `||`, `;`, `|`, and new lines, outside quotes. */
function segments(command: string) {
  const out: string[] = []
  let cur = ''
  let quote = ''
  for (let i = 0; i < command.length; i++) {
    const ch = command[i] as string
    if (quote) {
      quote = ch === quote ? '' : quote
      cur += ch
    } else if (ch === "'" || ch === '"') {
      quote = ch
      cur += ch
    } else if (ch === ';' || ch === '\n' || ch === '|' || ch === '&') {
      out.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }

  return [...out, cur].map(s => s.trim()).filter(Boolean)
}

/** One command's words, with quotes taken off as the shell would. */
function words(segment: string) {
  const out: string[] = []
  let cur = ''
  let quote = ''
  let has = false
  for (const ch of segment) {
    if (quote) {
      if (ch === quote) {
        quote = ''
      } else {
        cur += ch
      }
    } else if (ch === "'" || ch === '"') {
      quote = ch
      has = true
    } else if (/\s/.test(ch)) {
      if (has || cur) {
        out.push(cur)
      }
      cur = ''
      has = false
    } else {
      cur += ch
    }
  }
  if (has || cur) {
    out.push(cur)
  }

  return out
}

const WRAPPERS = new Set(['sudo', 'command', 'exec', 'time', 'nice', 'nohup', 'xargs', 'doas'])

/** The words from the command's own name on: past `sudo`, `xargs` and the like, their flags, and `VAR=value`. */
function commandWords(all: string[]) {
  let i = 0
  while (i < all.length && (WRAPPERS.has(all[i] as string) || /^-/.test(all[i] as string) || /^[A-Za-z_]\w*=/.test(all[i] as string))) {
    i += 1
  }

  return all.slice(i)
}

const hasFlag = (args: string[], short: string, long?: string) => args.some(a => (long !== undefined && a === long) || new RegExp(`^-[a-zA-Z]*${short}[a-zA-Z]*$`).test(a))

/** The git subcommand and its words, past `-C dir` and `-c key=value`. */
function gitWords(args: string[]) {
  let i = 0
  while (i < args.length && /^-/.test(args[i] as string)) {
    i += args[i] === '-C' || args[i] === '-c' ? 2 : 1
  }

  return { sub: args[i] ?? '', rest: args.slice(i + 1) }
}

/** What one git command destroys, if anything. */
function gitRisk(args: string[]) {
  const { sub, rest } = gitWords(args)
  switch (sub) {
    case 'push':
      return rest.includes('--force') || rest.some(a => /^-[a-zA-Z]*f[a-zA-Z]*$/.test(a)) || rest.some(a => /^\+/.test(a)) ? "force-pushes, which rewrites the remote branch's history" : undefined
    case 'reset':
      return rest.includes('--hard') ? 'throws away uncommitted changes' : undefined
    case 'clean':
      return (hasFlag(rest, 'f', '--force') && !hasFlag(rest, 'n', '--dry-run')) ? 'deletes untracked files' : undefined
    case 'checkout':
      return rest.includes('--') || rest.includes('.') ? 'throws away uncommitted changes to files' : undefined
    case 'restore':
      return rest.includes('--staged') && !rest.includes('--worktree') ? undefined : 'throws away uncommitted changes to files'
    case 'branch':
      return rest.includes('-D') || (rest.includes('--delete') && rest.includes('--force')) ? 'deletes a branch, merged or not' : undefined
    case 'stash':
      return rest[0] === 'drop' || rest[0] === 'clear' ? 'drops stashed changes' : undefined
    default:
      return undefined
  }
}

const isUnsizable = (path: string) => /[*?[\]{}$`~]/.test(path)

/**
 * What `command` destroys, or undefined for a command that destroys nothing the shield knows of. A recursive `rm`
 * names its targets; after a `cd`, a relative one is unsized, since it names a folder the mod cannot place.
 */
export function riskOf(command: string): Risk | undefined {
  const what = new Set<string>()
  const targets: Target[] = []
  let movedDir = false
  for (const segment of segments(command)) {
    const [word = '', ...args] = commandWords(words(segment))
    const name = word.split('/').pop() ?? '' // `/bin/rm` is rm
    if (name === 'cd' || name === 'pushd') {
      movedDir = true
    } else if (name === 'rm' && hasFlag(args.filter((_, i) => !args.slice(0, i).includes('--')), '[rR]', '--recursive')) {
      what.add(DELETES)
      const end = args.indexOf('--')
      for (const [i, path] of args.entries()) {
        const isPath = end >= 0 ? i > end : !/^-/.test(path)
        if (isPath) {
          targets.push(isUnsizable(path) || (movedDir && !path.startsWith('/')) ? { path, unsized: true } : { path })
        }
      }
    } else if (name === 'git') {
      const risk = gitRisk(args)
      if (risk) {
        what.add(risk)
      }
    } else if (name === 'find' && (args.includes('-delete') || (args.includes('-exec') && args.includes('rm')))) {
      what.add('deletes every file find matches')
    } else if (/^(terraform|tofu|pulumi)$/.test(name) && (args[0] === 'destroy' || args.includes('-destroy'))) {
      what.add('destroys infrastructure')
    } else if ((name === 'kubectl' && args[0] === 'delete') || (name === 'helm' && /^(uninstall|delete)$/.test(args[0] ?? ''))) {
      what.add('deletes cluster resources')
    } else if (name === 'docker' && ((args[0] === 'system' && args[1] === 'prune') || (args[0] === 'volume' && /^(rm|prune)$/.test(args[1] ?? '')))) {
      what.add('deletes Docker data')
    } else if (/^mkfs/.test(name) || (name === 'dd' && args.some(a => a.startsWith('of=/dev/')))) {
      what.add('writes over a disk')
    }
    if (/\bdrop\s+(table|database|schema)\b|\btruncate\s+table\b/i.test(segment)) {
      what.add('drops or empties database tables')
    }
  }

  return what.size > 0 ? { what: [...what], targets } : undefined
}

/** How many files `path` holds, counted through `fs`: links are counted, never followed, and the count stops at the cap. */
export async function sizeOf(path: string, fs: GuardFs): Promise<Size> {
  let top: { kind: string; isLink: boolean }
  try {
    top = await fs.stat(path)
  } catch {
    return { files: 0, isMissing: true }
  }
  if (top.isLink || top.kind !== 'dir') {
    return { files: 1 }
  }
  let files = 0
  let listed = 0
  const queue = [{ path, depth: 0 }]
  while (queue.length > 0) {
    const dir = queue.shift() as { path: string; depth: number }
    listed += 1
    if (listed > GUARD_DIRS) {
      return { files, isCapped: true }
    }
    let entries: { name: string; kind: string; isLink: boolean }[]
    try {
      entries = await fs.list(dir.path)
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.kind === 'dir' && !entry.isLink) {
        if (dir.depth + 1 > GUARD_DEPTH) {
          return { files, isCapped: true }
        }
        queue.push({ path: `${dir.path.replace(/\/$/, '')}/${entry.name}`, depth: dir.depth + 1 })
        continue
      }
      files += 1
      if (files >= GUARD_CAP) {
        return { files: GUARD_CAP, isCapped: true }
      }
    }
  }

  return { files }
}

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

function sizeText(target: Target, size: Size | undefined) {
  if (size === undefined) {
    return 'not sized'
  }
  // Claude's shell may have moved since the session began, so a relative path the mod cannot find may still be there.
  if (size.isMissing) {
    return target.path.startsWith('/') ? 'not there' : 'not found from the project folder'
  }

  return `${size.files}${size.isCapped ? '+' : ''} file${size.files === 1 && !size.isCapped ? '' : 's'}`
}

/** The question the shield asks before `command` runs; `sizes` line up with `risk.targets`, undefined where unsized. */
export function guardQuestion(command: string, risk: Risk, sizes: (Size | undefined)[]) {
  const shown = risk.targets.slice(0, MAX_TARGETS).map((t, i) => `${cut(t.path, MAX_PATH)}: ${sizeText(t, sizes[i])}`)
  const more = risk.targets.length > MAX_TARGETS ? [`${risk.targets.length - MAX_TARGETS} more`] : []
  const radius = shown.length > 0 ? ` ${[...shown, ...more].join(' · ')}.` : ''

  return `oxen-pet shield: \`${cut(command.replace(/\s+/g, ' ').trim(), MAX_COMMAND)}\` ${risk.what.join(', and ')}.${radius} Run it?`
}

/** The status line once the user answered: what the shield did. */
export const guardLine = (result: 'blocked' | 'ran') => (result === 'blocked' ? 'shield up: blocked it' : 'okay, let it through')
