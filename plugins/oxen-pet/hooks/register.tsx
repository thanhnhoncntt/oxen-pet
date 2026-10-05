import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Anim, Mode } from '../types'
import { TICK_MS, fail, leapClipMs, step } from './anim'
import { BAR_W, HUD_WINDOW_W, frameColor, hudFrom, hudRows, mood, windowEdges } from './hud'
import type { Hud } from './hud'
import { minisOnScreen, reconcile } from './minis'
import type { Mini } from './minis'
import { animate, readTheme, restingFrame } from './theme'
import { previewPage } from './preview'
import { previewPathError } from './previewPath'
import { readSettings } from './settings'
import { BODY_W, FACES, HEIGHT, MAX_MINIS, compose, crop, encodeCells, encodeSvg, trailWidth } from './pixels'
import type { Body } from './pixels'
import { GROUND_H, drawBand, layScene, obstacleSpans } from './scene'
import type { SceneLayout } from './scene'
import { lineColor, lineWidth, statusLine, targetOf, toolMode } from './status'
import type { ToolMode } from './status'

const ROWS = 10 // a cell is two pixels tall, so the frames are 20 px high
const GROUND_ROWS = GROUND_H / 2
const STATUS_ROOM = 20 // columns kept free beside a running pet for its status line
const USAGE_EVERY_BEATS = 20
const AGENTS_EVERY_BEATS = 5
const SLOW_BEATS: Partial<Record<Mode, number>> = { idle: 2, sleep: 4 } // ticks per redraw while nothing moves fast

const THEME_KEY = 'theme' // in $.store: the theme set_theme last took
const OWN_TOOLS = 'mcp__oxen-pet__'
// Literals, so `claude plugin validate` can read the hooks' matchers.
const SET_THEME = 'mcp__oxen-pet__set_theme'
const PREVIEW_THEME = 'mcp__oxen-pet__preview_theme'
const GET_THEME = 'mcp__oxen-pet__get_theme'

const anim = atom({ plugin: 'oxen-pet', key: 'anim' } as const, {
  mode: 'idle',
  since: 0,
  x: 0,
  dir: 1,
  tick: 0,
  target: '',
  working: false,
} as Anim)

/** The HUD from fresh usage, or `last` when the usage call fails. */
async function usageOr($: EngineInterface, now: number, last: Hud | undefined) {
  try {
    return hudFrom(await $.session.usage(), now)
  } catch {
    return last
  }
}

/** The minis after a fresh look at the session's agents, or `last` when the list call fails. */
async function minisOr($: EngineInterface, now: number, last: Mini[]) {
  try {
    return reconcile(last, await $.agent.list(), now)
  } catch {
    return last
  }
}

/** What preview_theme and set_theme tell Claude about a theme's pet: the clips and faces made, the resting frame, and readTheme's notes. */
function themeReport(pet: Body, notes: string[]) {
  const made = `${Object.keys(pet.clips).join(', ')}, and ${FACES.length} faces`
  const noted = notes.length > 0 ? `\n\nNotes, to act on or leave as drawn:\n- ${notes.join('\n- ')}` : ''

  return `The mod made every clip and face from the sprite: ${made}.\n\nResting frame (@ is a pupil, * a cheek):\n${restingFrame(pet)}${noted}`
}

/** The default slime theme, from the plugin's own file. */
async function slimeBody($: EngineInterface) {
  const read = readTheme(JSON.parse(await $.fs.read(`${$.plugin.root}/assets/slime.json`)))
  if (read.errors) {
    throw new Error(`assets/slime.json: ${read.errors.join(' ')}`)
  }

  return animate(read.theme)
}

/** The theme set_theme kept in an earlier session, else the slime. A kept theme this version cannot read gives way to the slime, with a toast. */
async function keptBody($: EngineInterface) {
  const kept = await $.store.get(THEME_KEY)
  if (kept !== undefined) {
    const read = readTheme(kept)
    if (!read.errors) {
      return animate(read.theme)
    }
    $.ui.toast(`oxen-pet: your theme no longer reads (${read.errors[0]}). Showing the slime.`)
  }

  return slimeBody($)
}

export const register: Register = (on, options) => {
  const settings = readSettings(options)
  let isWorking = false
  let lastToolAt = 0
  let activeTools = 0
  let activeMode: ToolMode = 'bash'
  let activeTarget = ''
  let bodyColumns = 80
  let beat = 0
  let showsError = false
  let body: Body | undefined
  let hud: Hud | undefined
  let minis: Mini[] = []
  let previewed: unknown // the last theme preview_theme drew, for set_theme to apply without resending it
  let layout: SceneLayout | undefined // the scene of `layoutOf` on a band `bandWidth()` wide
  let layoutOf: Body | undefined

  // The band leaves the last column free, so a full row never wraps.
  const bandWidth = () => Math.max(BODY_W, bodyColumns - 1)
  /** The layout of the pet's scene on the band as wide as it is now, or undefined for a pet with no scene. */
  const sceneLayout = (pet: Body) => {
    if (!pet.scene) {
      return undefined
    }
    if (layout?.width !== bandWidth() || layoutOf !== pet) {
      layout = layScene(pet.scene, bandWidth())
      layoutOf = pet
    }
    return layout
  }

  on('session.start', async ($, e, next) => {
    const now = await $.clock.now()
    await update($, anim, () => ({ mode: 'idle', since: now, x: 0, dir: 1, tick: 0, target: '', working: false }))
    hud = await usageOr($, now, undefined)
    try {
      await $.tool.register({
        name: 'preview_theme',
        description:
          'Writes the preview of a oxen-pet theme to `path`: an HTML page with every motion, face, status line, and HUD look of its pet, and the pet running through its scene. It does not change what is on screen. `theme` is in the format the `oxen-pet:oxen-pet` skill describes. Returns the resting frame and notes on anything repaired.',
        inputSchema: {
          type: 'object',
          properties: {
            theme: { type: 'object', description: 'The theme as a JSON object, in the format FORMAT.md documents.' },
            path: { type: 'string', description: 'Absolute path of the HTML file to write, such as one in the temp folder.' },
          },
          required: ['theme', 'path'],
        },
      })
      await $.tool.register({
        name: 'set_theme',
        description:
          'Sets the oxen-pet theme: the pet, its props, minis, status lines, HUD look, and scene, at once, kept for later sessions. `theme` is in the format the `oxen-pet:oxen-pet` skill describes, or null for the default slime. Leave `theme` out to set the last theme preview_theme drew in this session. Returns the resting frame and notes on anything repaired.',
        inputSchema: {
          type: 'object',
          properties: { theme: { type: ['object', 'null'], description: 'The theme as a JSON object, null for the default slime, or left out for the last preview.' } },
        },
      })
      await $.tool.register({
        name: 'get_theme',
        description:
          'Returns the oxen-pet theme on screen: the one set_theme kept, or the default slime\'s. Start a change from it, so set_theme keeps everything the change leaves alone.',
        inputSchema: { type: 'object', properties: {} },
      })
    } catch {
      // Without the tools the pet still draws; only changing the theme is missing.
    }

    $.clock.every(TICK_MS, async () => {
      const t = await $.clock.now()
      beat += 1
      if (beat % USAGE_EVERY_BEATS === 0) {
        hud = await usageOr($, t, hud)
        $.ui.invalidate('ui.render')
      }
      if (settings.minis && beat % AGENTS_EVERY_BEATS === 0) {
        minis = await minisOr($, t, minis)
      }

      const trail = trailWidth(minis.length)
      const room = Math.max(0, bodyColumns - BODY_W - trail - STATUS_ROOM)
      const scene = body && sceneLayout(body)
      const obstacles = scene ? obstacleSpans(scene) : []
      await update($, anim, a => {
        const moved = step(a, { isWorking, activeTools, activeMode, activeTarget, lastToolAt, room, obstacles, trail }, t, settings)
        // Minis hop on every tick, so they keep the redraw rate up while the pet idles.
        const slowBeat = minis.length > 0 ? undefined : SLOW_BEATS[moved.mode]
        return slowBeat !== undefined && moved.mode === a.mode && beat % slowBeat !== 0 ? a : moved
      })
    })

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (e.tool.startsWith(OWN_TOOLS)) {
      return next(e)
    }
    const t = await $.clock.now()
    activeTools += 1
    activeMode = toolMode(e.tool)
    const input = e as unknown as Record<string, unknown>
    activeTarget = settings.targets ? targetOf(e.tool, input) : ''
    lastToolAt = t

    let result: Awaited<ReturnType<typeof next>>
    try {
      result = await next(e)
    } finally {
      activeTools = Math.max(0, activeTools - 1)
      lastToolAt = await $.clock.now()
    }
    if ('deny' in result || ('isError' in result && result.isError)) {
      await update($, anim, a => fail(a, lastToolAt))
    }

    return result
  })

  on('tool.call', { tool: PREVIEW_THEME }, async ($, e) => {
    const { theme, path } = e as unknown as { theme?: unknown; path?: unknown }
    const read = readTheme(theme)
    if (read.errors) {
      return { deny: `No preview was written: ${read.errors.join(' ')}` }
    }
    const badPath = previewPathError(path)
    if (badPath !== undefined || typeof path !== 'string') {
      return { deny: `No preview was written: ${badPath}` }
    }
    const preview = animate(read.theme)
    await $.fs.write(path, previewPage(preview, read.notes))
    previewed = theme

    return { result: `Wrote the preview of ${read.theme.name} to ${path}. What is on screen has not changed.\n\n${themeReport(preview, read.notes)}` }
  })

  on('tool.call', { tool: GET_THEME }, async $ => {
    const kept = await $.store.get(THEME_KEY)
    if (kept === undefined) {
      return { result: `No theme is kept, so the slime is on screen. Its theme:\n\n${await $.fs.read(`${$.plugin.root}/assets/slime.json`)}` }
    }

    return { result: `The theme set_theme kept:\n\n${JSON.stringify(kept, null, 2)}` }
  })

  on('tool.call', { tool: SET_THEME }, async ($, e) => {
    const given = (e as unknown as { theme?: unknown }).theme
    if (given === undefined && previewed === undefined) {
      return { deny: 'The theme was not set: no preview_theme call in this session to apply. Pass `theme`.' }
    }
    const value = given === undefined ? previewed : given
    if (value === null) {
      await $.store.delete(THEME_KEY)
      body = await slimeBody($)
      $.ui.invalidate('ui.render')

      return { result: 'The slime is back, for this session and later ones.' }
    }
    const read = readTheme(value)
    if (read.errors) {
      return { deny: `The theme was not set: ${read.errors.join(' ')}` }
    }
    await $.store.set(THEME_KEY, value)
    body = animate(read.theme)
    $.ui.invalidate('ui.render')

    return { result: `The ${read.theme.name} theme is on screen now, for this session and later ones.\n\n${themeReport(body, read.notes)}` }
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    if (!settings.hud || !hud || e.surface !== 'terminal') {
      return next(e)
    }
    if (!body) {
      body = await keptBody($)
    }
    const rows = hudRows(hud, body.look.hud)
    if (rows.length === 0) {
      return next(e)
    }
    const { Box, Raster, Text } = $.ui.resolve(e)
    const edges = windowEdges(HUD_WINDOW_W)
    const frame = frameColor(body.look.hud)

    return (
      <Box flexDirection="column">
        {await next(e)}
        <Box flexDirection="column" marginLeft={1}>
          <Text color={frame}>{edges.top}</Text>
          {rows.map(r => (
            <Box key={r.key}>
              <Text color={frame}>{edges.side}</Text>
              <Box width={HUD_WINDOW_W - 2} paddingLeft={1}>
                <Text color={r.color}>{r.label} </Text>
                <Raster key={`bar-${r.key}`} columns={BAR_W} rows={1} cells={r.cells} />
                {r.parts.map((p, i) => (
                  <Text key={String(i)} color={p.color} bold={p.bold} wrap="truncate">
                    {p.text}
                  </Text>
                ))}
              </Box>
              <Text color={frame}>{edges.side}</Text>
            </Box>
          ))}
          <Text color={frame}>{edges.bottom}</Text>
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    try {
      if (e.props.hasSurvey) {
        return next(e)
      }
      isWorking = e.props.isWorking
      bodyColumns = e.props.bodyColumns

      if (!body) {
        body = await keptBody($)
      }
      const a = await read($, anim)
      const now = await $.clock.now()
      const elapsed = now - a.since
      const views = minisOnScreen(minis, now)
      // A leap is the run mode playing the jump clip, slowed, while the pet travels.
      const drawn = a.leap ? { mode: 'jump' as const, ms: leapClipMs((now - a.leap.since) * settings.pace) } : { mode: a.mode, ms: elapsed * settings.pace }
      const picture = compose(body, drawn.mode, drawn.ms, a.dir, hud ? mood(hud) : 'ok', views)
      const extra = views.length > MAX_MINIS ? ` (+${views.length - MAX_MINIS} minis)` : ''
      const line = settings.statusLine ? statusLine(a.mode, a.since, elapsed, a.target, body.look.lines[a.mode]) + extra : ''
      if (showsError) {
        showsError = false
        $.ui.status(undefined)
      }

      const scene = sceneLayout(body)
      if (e.surface === 'terminal' && scene && body.scene) {
        const { Box, Raster, Text } = $.ui.resolve(e)
        const width = scene.width
        const textW = line ? lineWidth(line) + 3 : 0
        const left = Math.max(0, Math.min(Math.round(a.x), width - picture.w - textW))
        const band = drawBand(body, body.scene, scene, picture, left, now)
        const cells = (x: number, y: number, w: number, h: number) => encodeCells(crop(band, x, y, w, h))
        // The status line cuts a hole in the band; the band shows above, below, and right of it.
        const textAt = left + picture.w
        const shown = Math.min(textW, width - textAt)
        const rest = width - textAt - shown

        return (
          <Box flexDirection="column" height={ROWS + GROUND_ROWS}>
            <Box height={ROWS}>
              <Raster key="pet" columns={textAt} rows={ROWS} cells={cells(0, 0, textAt, HEIGHT)} />
              {shown > 0 && (
                <Box key="line" flexDirection="column" width={shown}>
                  <Raster key="above" columns={shown} rows={ROWS - 2} cells={cells(textAt, 0, shown, HEIGHT - 4)} />
                  <Text color={lineColor(a.mode, body.look.lineColors)} bold wrap="truncate">
                    {` › ${line}`}
                  </Text>
                  <Raster key="below" columns={shown} rows={1} cells={cells(textAt, HEIGHT - 2, shown, 2)} />
                </Box>
              )}
              {rest > 0 && <Raster key="rest" columns={rest} rows={ROWS} cells={cells(textAt + shown, 0, rest, HEIGHT)} />}
            </Box>
            <Raster key="ground" columns={width} rows={GROUND_ROWS} cells={cells(0, HEIGHT, width, GROUND_H)} />
          </Box>
        )
      }
      if (e.surface === 'terminal') {
        const { Box, Raster, Text } = $.ui.resolve(e)
        const room = Math.max(0, bodyColumns - picture.w - line.length - 4)

        return (
          <Box height={ROWS}>
            <Box marginLeft={Math.min(Math.round(a.x), room)} alignItems="flex-end">
              <Raster key="pet" columns={picture.w} rows={ROWS} cells={encodeCells(picture)} />
              {line && (
                <Box marginBottom={1} marginLeft={1}>
                  <Text color={lineColor(a.mode, body.look.lineColors)} bold>
                    › {line}
                  </Text>
                </Box>
              )}
            </Box>
          </Box>
        )
      }
      if (e.surface === 'desktop') {
        const { Box, Svg, Text } = $.ui.resolve(e)

        return (
          <Box alignItems="flex-end">
            <Box marginLeft={Math.round(a.x)}>
              <Svg source={encodeSvg(picture)} alt={`${body.name}, ${a.mode}`} width={picture.w * 4} height={80} />
            </Box>
            {line && (
              <Text color={lineColor(a.mode, body.look.lineColors)} bold>
                {line}
              </Text>
            )}
          </Box>
        )
      }

      return next(e)
    } catch (err) {
      showsError = true
      $.ui.status(`oxen-pet: ${String(err)}`)

      return next(e)
    }
  })
}
