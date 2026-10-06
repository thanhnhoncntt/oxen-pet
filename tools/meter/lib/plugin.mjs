// The plugin's own modules, for the CLI and the team report: analysis, records, files and guards are the mod's, so
// every tool's sessions are read alike. Node 22.18 or later runs them as TypeScript.
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'

// The hooks import each other without an extension, as the mod's bundler allows.
registerHooks({ resolve: (spec, ctx, next) => next(/^\.\.?\//.test(spec) && !/\.[a-z]+$/.test(spec) ? `${spec}.ts` : spec, ctx) })

const hooks = new URL('../../../plugins/oxen-meter/hooks/', import.meta.url)
const load = name => import(new URL(`${name}.ts`, hooks).href)

export const analyze = await load('analyze')
export const codexLog = await load('codexLog')
export const dataPath = await load('dataPath')
export const devinLog = await load('devinLog')
export const exportFile = await load('exportFile')
export const project = await load('project')
export const record = await load('record')
export const report = await load('report')
export const sessionFile = await load('sessionFile')
export const settings = await load('settings')
export const timing = await load('timing')

/** The meter's version, from the plugin's manifest. */
export function versionOf() {
  try {
    return JSON.parse(readFileSync(new URL('../../../plugins/oxen-meter/.claude-plugin/plugin.json', import.meta.url), 'utf8')).version ?? 'unknown'
  } catch {
    return 'unknown'
  }
}
