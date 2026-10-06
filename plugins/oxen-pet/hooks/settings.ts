import { DEFAULT_THEME, isThemeName } from './custom'

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
  hudRow: boolean // the HUD lays its bars side by side in one row
  theme: string // the pet a session starts with: a built-in one or one in the custom folder, by name
  customDir: string // where the user's own themes are; empty for the .claude folder's oxen-pet/themes
}

const PACE: Record<string, number> = { slow: 0.6, normal: 1, fast: 1.6 }
const CACHE_TTL: Record<string, number> = { '1h': 60, '5m': 5, off: 0 }

export const DEFAULTS: Settings = { pace: 1, sleepAfterMs: 60000, hud: true, statusLine: true, targets: false, minis: true, cacheTtlMin: 60, guard: false, boss: true, hudRow: true, theme: DEFAULT_THEME, customDir: '' }

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
    hudRow: options.hudLayout !== 'stacked',
    theme: typeof options.theme === 'string' && isThemeName(options.theme.trim()) ? options.theme.trim() : DEFAULT_THEME,
    customDir: typeof options.customDir === 'string' ? options.customDir : DEFAULTS.customDir,
  }
}
