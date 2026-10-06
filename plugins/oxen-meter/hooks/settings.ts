/** The user's settings, from the plugin's `userConfig`, as the meter uses them. */
export type Settings = {
  resumeGuard: 'off' | 'warn' | 'ask' // what happens before a cold resume
  coldTokens: number // the context a re-write must reach to count as a cold resume
  mainTtl: TtlSetting // the main thread's cache TTL; auto takes the measured or inferred one
  subagentTtl: TtlSetting
  userLabel: string // the name exports carry; empty for anonymous
  hashProject: boolean // records keep the project as a hash
  outputWeight: number // one output token in uncached input tokens, for the token equivalent
  retentionDays: number // session files older than this are emptied
  dataDir: string // where sessions and exports go; empty for the .claude folder's oxen-meter
}

export type TtlSetting = 'auto' | '5m' | '1h'

const GUARDS = ['off', 'warn', 'ask'] as const
const TTLS = ['auto', '5m', '1h'] as const
const MAX_LABEL = 40

export const DEFAULTS: Settings = { resumeGuard: 'warn', coldTokens: 50000, mainTtl: 'auto', subagentTtl: 'auto', userLabel: '', hashProject: true, outputWeight: 5, retentionDays: 30, dataDir: '' }

const oneOf = <T extends string>(values: readonly T[], v: unknown, fallback: T): T => ((values as readonly unknown[]).includes(v) ? (v as T) : fallback)
const number = (v: unknown, min: number, max: number, fallback: number) => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : fallback)

/**
 * Settings from the options Claude Code passes to `register`. A missing or malformed value takes its default, so
 * settings saved by another version of the meter never stop it loading.
 */
export function readSettings(options: Readonly<Record<string, unknown>>): Settings {
  return {
    resumeGuard: oneOf(GUARDS, options.resumeGuard, DEFAULTS.resumeGuard),
    coldTokens: number(options.coldTokens, 0, 2000000, DEFAULTS.coldTokens),
    mainTtl: oneOf(TTLS, options.mainTtl, DEFAULTS.mainTtl),
    subagentTtl: oneOf(TTLS, options.subagentTtl, DEFAULTS.subagentTtl),
    userLabel: typeof options.userLabel === 'string' ? options.userLabel.trim().slice(0, MAX_LABEL) : DEFAULTS.userLabel,
    hashProject: typeof options.hashProject === 'boolean' ? options.hashProject : DEFAULTS.hashProject,
    outputWeight: number(options.outputWeight, 0, 100, DEFAULTS.outputWeight),
    retentionDays: Math.round(number(options.retentionDays, 1, 3650, DEFAULTS.retentionDays)),
    dataDir: typeof options.dataDir === 'string' ? options.dataDir.trim() : DEFAULTS.dataDir,
  }
}

/** The cache TTL of `role` in minutes: the setting's, or for auto the inferred one, else 1h for main and 5m for a subagent. */
export function ttlMinOf(setting: TtlSetting, role: 'main' | 'subagent', inferredMin?: number) {
  if (setting !== 'auto') {
    return setting === '5m' ? 5 : 60
  }

  return inferredMin ?? (role === 'main' ? 60 : 5)
}
