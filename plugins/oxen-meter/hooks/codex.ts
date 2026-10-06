/**
 * What a Bash command is, by its text, for the records: a Codex call (a handoff to another model) or an outcome (a
 * commit, a pull request). Only the label leaves this module; the command itself is never kept.
 */

/** A Codex call, named by its sub-command (`task`, `review`, `exec`, ...) or `run` for a bare prompt. */
export type CodexCall = { sub: string }
export type Outcome = 'commit' | 'pr'

const ENV = /^(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)\s+)*/
const COMPANION = /codex-companion\.mjs["']?\s+([a-z][a-z-]*)/
const CLI = /^codex(?:\s+([a-z][a-z-]*))?(?:\s|$)/
const COMMIT = /^git(?:\s+-[A-Za-z]\s+\S+|\s+--?[\w-]+(?:=\S+)?)*\s+commit(?:\s|$)/
const PR = /^gh\s+pr\s+create(?:\s|$)/

/** The command's parts, split where the shell starts another command, each without its leading env assignments. */
const partsOf = (command: string) =>
  command
    .split(/&&|\|\||[;|\n]/)
    .map(p => p.trim().replace(/^\(+\s*/, '').replace(ENV, ''))
    .filter(p => p !== '')

export function codexCallOf(command: string): CodexCall | undefined {
  for (const part of partsOf(command)) {
    const companion = part.match(COMPANION)
    if (companion) {
      return { sub: companion[1]! }
    }
    const cli = part.match(CLI)
    if (cli) {
      return { sub: cli[1] ?? 'run' }
    }
  }

  return undefined
}

export function outcomeOf(command: string): Outcome | undefined {
  const parts = partsOf(command)
  if (parts.some(p => PR.test(p))) {
    return 'pr'
  }

  return parts.some(p => COMMIT.test(p)) ? 'commit' : undefined
}
