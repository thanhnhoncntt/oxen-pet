// Where the CLI reads and writes, and the settings it runs with: the oxen-meter options the user set in Claude Code,
// read from ~/.claude/settings.json, so the mod and the CLI measure alike. The home folder is the only thing it takes
// from the environment, through os.homedir().
import { homedir } from 'node:os'
import { join } from 'node:path'

import { readJson, writeGuarded } from './files.mjs'
import { dataPath, settings as settingsModule } from './plugin.mjs'

/** The options of the oxen-meter plugin in a Claude Code settings file, from whichever marketplace it came. */
export function pluginOptions(claudeSettings) {
  const configs = claudeSettings?.pluginConfigs
  if (configs === null || typeof configs !== 'object') {
    return {}
  }
  const key = Object.keys(configs).find(k => k.startsWith('oxen-meter@'))
  const options = key === undefined ? undefined : configs[key]?.options

  return options !== null && typeof options === 'object' ? options : {}
}

/**
 * Where the CLI works: the home folder, the data folder, Codex's and Devin's folders, and the settings, each of which
 * a flag can name instead (`--data`, `--codex-home`, `--devin-home`, `--claude-settings`).
 */
export function configOf(flags = {}) {
  const home = flags.home ?? homedir()
  const claudeSettings = readJson(flags.claudeSettings ?? join(home, '.claude', 'settings.json'))
  const settings = settingsModule.readSettings(pluginOptions(claudeSettings))
  const root = flags.data ?? dataPath.dataRootOf(join(home, '.claude', 'plugins', 'oxen-meter'), settings.dataDir)

  return { home, root, settings, codexHome: flags.codexHome ?? join(home, '.codex'), devinHome: flags.devinHome ?? join(home, '.local', 'share', 'devin', 'cli') }
}

/** The salt the mod and the CLI share, made and written to the data folder the first time it is needed. */
export function saltOf(root) {
  const path = dataPath.saltPath(root)
  const salt = readJson(path)?.salt
  if (typeof salt === 'string' && salt.length >= 8) {
    return salt
  }
  const made = crypto.randomUUID()
  writeGuarded(root, path, JSON.stringify({ salt: made }))

  return made
}
