// Writes tools/preview/preview.html: the same preview the preview_theme tool writes, for a theme file.
// Run: node tools/preview/build.mjs [theme file], the default slime when no theme file is given. It prints the
// pet's resting frame and notes, or exits 1 when the theme has no sprite. Needs Node 22.18 or later.
import { readFileSync, writeFileSync } from 'node:fs'
import { registerHooks } from 'node:module'

// The hooks import each other without an extension, as the mod's bundler allows.
registerHooks({ resolve: (spec, ctx, next) => next(/^\.\.?\//.test(spec) && !/\.[a-z]+$/.test(spec) ? `${spec}.ts` : spec, ctx) })
const plugin = new URL('../../plugins/oxen-pet/', import.meta.url)
const { animate, readTheme, restingFrame } = await import(new URL('hooks/theme.ts', plugin).href)
const { previewPage } = await import(new URL('hooks/preview.ts', plugin).href)

const themeFile = process.argv[2] ?? new URL('assets/slime.json', plugin)
const read = readTheme(JSON.parse(readFileSync(themeFile, 'utf8')))
if (read.errors) {
  console.error(`${themeFile}: ${read.errors.join(' ')}`)
  process.exit(1)
}
const body = animate(read.theme)
console.log(restingFrame(body))
for (const note of read.notes) console.log(`note: ${note}`)

const out = new URL('preview.html', import.meta.url)
writeFileSync(out, previewPage(body, read.notes))
console.log(`wrote ${out.pathname}`)
