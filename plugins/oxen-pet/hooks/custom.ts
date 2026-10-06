/**
 * The user's own themes: a folder of `<name>.theme.json` files outside the plugin's install folder, which an update
 * replaces. The mod reads no environment, so it finds the user's `.claude` folder from where the plugin is installed,
 * unless the Custom folder setting names another.
 */

/** The pets that ship with the plugin, in `assets/`; the first is the default. */
export const BUILT_IN = ['luffy', 'slime', 'duck', 'alien'] as const
export const DEFAULT_THEME = BUILT_IN[0]
const SUFFIX = '.theme.json'

const isAbsolute = (path: string) => path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path)

/** The custom folder: the setting's, when it is an absolute path with no `..`; else `oxen-pet/themes` in the `.claude` folder the plugin is installed under. */
export function customDirOf(pluginRoot: string, setting: string): string | undefined {
  const asked = setting.trim()
  if (isAbsolute(asked) && !asked.split(/[\\/]/).includes('..') && !/[$~]/.test(asked)) {
    return asked.replace(/[\\/]+$/, '')
  }
  const at = pluginRoot.search(/[\\/]\.claude[\\/]/)

  return at < 0 ? undefined : `${pluginRoot.slice(0, at + '/.claude'.length)}/oxen-pet/themes`
}

/** Whether `name` names a theme: letters, digits, `-` and `_`, so it stays one file in the folder. */
export const isThemeName = (name: string) => /^[A-Za-z0-9_-]{1,40}$/.test(name)

export const themeFile = (dir: string, name: string) => `${dir}/${name}${SUFFIX}`

/** The theme names among a folder's entries: its `<name>.theme.json` files, sorted. */
export const themeNames = (entries: readonly { name: string; kind: string }[]) =>
  entries
    .filter(e => e.kind === 'file' && e.name.endsWith(SUFFIX))
    .map(e => e.name.slice(0, -SUFFIX.length))
    .filter(isThemeName)
    .sort()

/** What `/pet theme` prints: the built-in pets and the user's own, the one on screen marked, and where the folder is. */
export function themeList(own: string[], current: string | undefined, dir: string | undefined) {
  const mark = (name: string) => (name === current ? `${name} ◀ on screen` : name)
  const where = dir
    ? `Your themes folder: ${dir}\nPut <name>.theme.json there, or ask Claude to draw a pet and save it there. Updates never touch it.`
    : 'No themes folder yet. Set Custom folder in /plugin configure oxen-pet@oxen-pet to an absolute path.'

  return [`Built in: ${BUILT_IN.map(mark).join(', ')}`, `Yours: ${own.length > 0 ? own.map(mark).join(', ') : 'none yet'}`, where, 'Switch with /pet theme <name>.'].join('\n')
}
