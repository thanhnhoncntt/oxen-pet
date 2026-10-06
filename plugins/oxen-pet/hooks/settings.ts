/** The user's settings, from the plugin's `userConfig`, as the mod uses them. */
export type Settings = {
  pace: number // 1 is normal; the pet runs and animates this many times as fast
  sleepAfterMs: number // 0 keeps the pet awake
  hud: boolean
  statusLine: boolean
  targets: boolean // the status line names files, patterns, commands, and hosts
  minis: boolean
  cacheTtlMin: number // how long the prompt cache stays warm after a turn; 0 hides the cache timer
  guard: boolean // the shield asks before a destructive command runs unasked
  boss: boolean // a failed test run brings a bug boss into the band
}

const PACE: Record<string, number> = { slow: 0.6, normal: 1, fast: 1.6 }
const CACHE_TTL: Record<string, number> = { '1h': 60, '5m': 5, off: 0 }

export const DEFAULTS: Settings = { pace: 1, sleepAfterMs: 60000, hud: true, statusLine: true, targets: false, minis: true, cacheTtlMin: 60, guard: true, boss: true }

const flag = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback)

/**
 * Settings from the options Claude Code passes to `register`. A missing or malformed value takes its default,
 * so settings saved by another version of the mod never stop it loading.
 */
export function readSettings(options: Readonly<Record<string, unknown>>): Settings {
  const sleep = options.sleepAfter

  return {
    pace: PACE[String(options.speed)] ?? DEFAULTS.pace,
    sleepAfterMs: typeof sleep === 'number' && Number.isFinite(sleep) && sleep >= 0 ? sleep * 1000 : DEFAULTS.sleepAfterMs,
    hud: flag(options.hud, DEFAULTS.hud),
    statusLine: flag(options.statusLine, DEFAULTS.statusLine),
    targets: flag(options.targets, DEFAULTS.targets),
    minis: flag(options.minis, DEFAULTS.minis),
    cacheTtlMin: Object.hasOwn(CACHE_TTL, String(options.cacheTtl)) ? CACHE_TTL[String(options.cacheTtl)]! : DEFAULTS.cacheTtlMin,
    guard: flag(options.guard, DEFAULTS.guard),
    boss: flag(options.boss, DEFAULTS.boss),
  }
}
