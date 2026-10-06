import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Anim, Mode } from '../types'
import { TICK_MS, fail, leapClipMs, step } from './anim'
import { BUILT_IN, DEFAULT_THEME, customDirOf, isThemeName, themeFile, themeList, themeNames } from './custom'
import { BOSS_W, bossAfter, bossAlt, bossOnScreen, drawBoss, isTestCommand, testOutcome } from './boss'
import type { Boss } from './boss'
import { GUARD_OPTIONS, guardLine, guardQuestion, riskOf, sizeOf } from './guard'
import type { Risk } from './guard'
import { newStats, noteMp, recordShield, recordTest, recordTool, recordTurn, statsRows } from './stats'
import { DETAIL_COLOR, HUD_WINDOW_W, ROW_GAP, cacheLeftMin, hudRowWidth, contextAlert, contextAlertText, frameColor, hudFrom, hudRows, mood, windowEdges } from './hud'
import type { Hud } from './hud'
import { minisOnScreen, reconcile } from './minis'
import type { Mini } from './minis'
import { animate, readTheme, restingFrame } from './theme'
import { previewPage } from './preview'
import { previewPathError, previewTargetError } from './previewPath'
import { readSettings } from './settings'
import { BODY_W, FACES, HEIGHT, MAX_MINIS, compose, composeFace, crop, encodeCells, encodeSvg, overlay, trailWidth } from './pixels'
import type { Body } from './pixels'
import { DESKTOP_BAND_W, GROUND_H, drawBand, layScene, obstacleSpans } from './scene'
import type { SceneLayout } from './scene'
import { lineColor, lineWidth, statusLine, targetOf, toolMode } from './status'
import type { ToolMode } from './status'

const ROWS = 10 // a cell is two pixels tall, so the frames are 20 px high
const GROUND_ROWS = GROUND_H / 2
const STATUS_ROOM = 20 // columns kept free beside a running pet for its status line
const USAGE_EVERY_BEATS = 20
const AGENTS_EVERY_BEATS = 5
const SLOW_BEATS: Partial<Record<Mode, number>> = { idle: 2, sleep: 4 } // ticks per redraw while nothing moves fast
const SVG_PX = 4 // CSS pixels per pet pixel on the desktop
const HUD_SVG_PX = 6 // CSS pixels per bar pixel on the desktop, so a bar is as tall as its text

const GUARD_HOLD_MS = 2500 // how long the shield stays up after the answer, so it shows even when the dialog hid the band
const NOTICE_MS = 8000 // how long the pet says the context is almost full
const NOTICE_COLOR = '#f0506e'
const BLOCKED = 'The user blocked this command with the oxen-pet shield. Ask them before trying it another way.'
const UNANSWERED = 'Blocked by the oxen-pet shield: no one answered its question. To let destructive commands run unasked, turn off Shield in /plugin configure oxen-pet@oxen-pet.'

const THEME_KEY = 'theme' // in $.store: the theme set_theme last took
const CHOSEN_KEY = 'chosen' // in $.store: the theme /pet theme last put on screen, by name
const OWN_TOOLS = 'mcp__oxen-pet__'
// Literals, so `claude plugin validate` can read the hooks' matchers.
const SET_THEME = 'mcp__oxen-pet__set_theme'
const PREVIEW_THEME = 'mcp__oxen-pet__preview_theme'
const GET_THEME = 'mcp__oxen-pet__get_theme'
const PET_COMMAND = 'pet'
const PANE_ID = 'pet'

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

/** The stat of `path` with where it lands, or undefined when nothing is there. */
async function statOf($: EngineInterface, path: string) {
  try {
    return await $.fs.stat(path, { resolve: true })
  } catch {
    return undefined
  }
}

/** Why preview_theme must not write to `path`: its spelling first, then where it leads on disk. */
async function previewWriteError($: EngineInterface, path: unknown) {
  const spelled = previewPathError(path)
  if (spelled !== undefined || typeof path !== 'string') {
    return spelled
  }
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))

  return previewTargetError(await statOf($, path), await statOf($, path.slice(0, cut + 1)))
}

/** How many files each of `risk`'s targets holds, undefined where its spelling cannot be sized. */
async function sizesOf($: EngineInterface, risk: Risk) {
  const fs = { stat: (path: string) => $.fs.stat(path), list: (path: string) => $.fs.list(path) }

  return Promise.all(risk.targets.map(t => (t.unsized ? undefined : sizeOf(t.path, fs))))
}

/** What preview_theme and set_theme tell Claude about a theme's pet: the clips and faces made, the resting frame, and readTheme's notes. */
function themeReport(pet: Body, notes: string[]) {
  const made = `${Object.keys(pet.clips).join(', ')}, and ${FACES.length} faces`
  const noted = notes.length > 0 ? `\n\nNotes, to act on or leave as drawn:\n- ${notes.join('\n- ')}` : ''

  return `The mod made every clip and face from the sprite: ${made}.\n\nResting frame (@ is a pupil, * a cheek):\n${restingFrame(pet)}${noted}`
}

/** The default pet, from the plugin's own file. */
async function defaultBody($: EngineInterface) {
  const read = readTheme(JSON.parse(await $.fs.read(`${$.plugin.root}/assets/${DEFAULT_THEME}.json`)))
  if (read.errors) {
    throw new Error(`assets/${DEFAULT_THEME}.json: ${read.errors.join(' ')}`)
  }

  return animate(read.theme)
}

/**
 * A theme by name, as its file spells it: the custom folder's `<name>.theme.json` first, so the user's own wins over a
 * built-in one of the same name, then the plugin's `assets/<name>.json`. Throws when neither is there or it is not JSON.
 */
async function namedTheme($: EngineInterface, name: string, dir: string | undefined): Promise<unknown> {
  if (!isThemeName(name)) {
    throw new Error(`No theme named ${name}.`)
  }
  if (dir !== undefined && (await $.fs.exists(themeFile(dir, name)).catch(() => false))) {
    return JSON.parse(await $.fs.read(themeFile(dir, name)))
  }
  if ((BUILT_IN as readonly string[]).includes(name)) {
    return JSON.parse(await $.fs.read(`${$.plugin.root}/assets/${name}.json`))
  }
  throw new Error(`No theme named ${name}.`)
}

/**
 * The pet a session shows: the theme set_theme kept, else the one /pet theme chose, else the Theme setting's, else
 * the default. One that no longer reads gives way to the next, with a toast.
 */
async function keptBody($: EngineInterface, setting: string, customDir: string) {
  const kept = await $.store.get(THEME_KEY)
  if (kept !== undefined) {
    const read = readTheme(kept)
    if (!read.errors) {
      return animate(read.theme)
    }
    $.ui.toast(`oxen-pet: your theme no longer reads (${read.errors[0]}). Showing ${DEFAULT_THEME}.`)
  }
  const chosen = await $.store.get(CHOSEN_KEY)
  const name = typeof chosen === 'string' ? chosen : setting
  try {
    const read = readTheme(await namedTheme($, name, customDirOf($.plugin.root, customDir)))
    if (read.errors) {
      throw new Error(read.errors[0])
    }
    return animate(read.theme)
  } catch (err) {
    $.ui.toast(`oxen-pet: the ${name} theme does not read (${err instanceof Error ? err.message : String(err)}). Showing ${DEFAULT_THEME}.`)
  }

  return defaultBody($)
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
  let lastTurnEndAt: number | undefined // when the main thread's last turn ended, which keeps its prompt cache warm
  let minis: Mini[] = []
  let previewed: unknown // the last theme preview_theme drew, for set_theme to apply without resending it
  let layout: SceneLayout | undefined // the scene of `layoutOf` on a band `bandWidth()` wide
  let layoutOf: Body | undefined
  let guarding = 0 // risky commands waiting for the user's answer
  let shield: { result: 'blocked' | 'ran'; until: number } | undefined // the last answer, shown until `until`
  let boss: Boss | undefined
  let alertArmed = true // the low-context alert fires once per drop under LOW_HP
  let notice: { text: string; until: number } | undefined // what the pet says in place of its status line, until `until`
  let stats = newStats(0)

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
    lastTurnEndAt = undefined
    stats = newStats(now)
    try {
      await $.tool.register({
        name: 'preview_theme',
        description:
          'Writes the preview of a oxen-pet theme to `path`: an HTML page with every motion, face, status line, and HUD look of its pet, and the pet running through its scene. It does not change what is on screen. `theme` is in the format the `oxen-pet:oxen-pet` skill describes. Returns the resting frame and notes on anything repaired.',
        inputSchema: {
          type: 'object',
          properties: {
            theme: { type: 'object', description: 'The theme as a JSON object, in the format FORMAT.md documents.' },
            path: { type: 'string', description: 'Absolute path of the HTML file to write, in an existing folder, named oxen-pet-preview….html, such as /tmp/oxen-pet-preview-cat.html. No `..`, no symbolic link; any other path is refused.' },
          },
          required: ['theme', 'path'],
        },
      })
      await $.tool.register({
        name: 'set_theme',
        description:
          'Sets the oxen-pet theme: the pet, its props, minis, status lines, HUD look, and scene, at once, kept for later sessions. `theme` is in the format the `oxen-pet:oxen-pet` skill describes, or null for the default pet. Leave `theme` out to set the last theme preview_theme drew in this session. Returns the resting frame and notes on anything repaired.',
        inputSchema: {
          type: 'object',
          properties: { theme: { type: ['object', 'null'], description: 'The theme as a JSON object, null for the default pet, or left out for the last preview.' } },
        },
      })
      await $.tool.register({
        name: 'get_theme',
        description:
          'Returns the oxen-pet theme on screen: the one set_theme kept, or the one chosen by name (by default Luffy), and where the user\'s own themes folder is. Start a change from it, so set_theme keeps everything the change leaves alone.',
        inputSchema: { type: 'object', properties: {} },
      })
    } catch {
      // Without the tools the pet still draws; only changing the theme is missing.
    }
    try {
      await $.command.register({ name: PET_COMMAND, description: 'oxen-pet: open or close the session stats pane; /pet theme lists or switches pets', argumentHint: '[theme [name]]', immediate: true })
    } catch {
      // Without the command the pet and the HUD still draw; only the stats pane is missing.
    }

    $.clock.every(TICK_MS, async () => {
      const t = await $.clock.now()
      beat += 1
      if (beat % USAGE_EVERY_BEATS === 0) {
        hud = await usageOr($, t, hud)
        if (hud?.mp !== undefined) {
          stats = noteMp(stats, hud.mp, t)
        }
        if (settings.hud && hud) {
          const alert = contextAlert(alertArmed, hud.hp)
          alertArmed = alert.armed
          if (alert.alert) {
            $.ui.toast(contextAlertText(hud.hp), { timeoutMs: 10000 })
            notice = { text: 'context almost full: /compact?', until: t + NOTICE_MS }
          }
        }
        $.ui.invalidate('ui.render')
      }
      if (settings.minis && beat % AGENTS_EVERY_BEATS === 0) {
        minis = await minisOr($, t, minis)
      }

      const trail = trailWidth(minis.length)
      // A boss stands at the right of the band, so the running pet turns before it.
      const bossRoom = settings.boss && bossOnScreen(boss, t) ? BOSS_W + 2 : 0
      const room = Math.max(0, bodyColumns - BODY_W - trail - STATUS_ROOM - bossRoom)
      const scene = body && sceneLayout(body)
      const obstacles = scene ? obstacleSpans(scene) : []
      const isGuarding = guarding > 0 || (shield !== undefined && t < shield.until)
      await update($, anim, a => {
        const moved = step(a, { isWorking, activeTools, activeMode, activeTarget, lastToolAt, room, obstacles, trail, guarding: isGuarding }, t, settings)
        // Minis and the boss move on every tick, so they keep the redraw rate up while the pet idles.
        const slowBeat = minis.length > 0 || bossRoom > 0 ? undefined : SLOW_BEATS[moved.mode]
        return slowBeat !== undefined && moved.mode === a.mode && beat % slowBeat !== 0 ? a : moved
      })
    })

    return next(e)
  })

  // A subagent's requests carry its own prompt, so only the main thread's turns keep the session's cache warm.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) {
      lastTurnEndAt = await $.clock.now()
      stats = recordTurn(stats)
      $.ui.invalidate('ui.render')
    }

    return result
  })

  // The shield: a destructive command that would run unasked waits for the user's answer, the pet holding up its shield.
  on('tool.check', { tool: 'Bash' }, async ($, e, next) => {
    const verdict = await next(e)
    // A query (no tool_use_id) asks what would happen, and must never open a dialog.
    if (!settings.guard || e.tool_use_id === undefined || verdict.decision === 'deny') {
      return verdict
    }
    let command: string
    let risk: Risk | undefined
    try {
      const given = (e.input as { command?: unknown } | undefined)?.command
      command = typeof given === 'string' ? given : ''
      risk = riskOf(command)
    } catch {
      return verdict
    }
    if (!risk) {
      return verdict
    }
    const question = guardQuestion(command, risk, await sizesOf($, risk).catch(() => []))
    // Claude Code asks already: its dialog shows what the command deletes.
    if (verdict.decision === 'ask') {
      return { ...verdict, reason: question }
    }
    guarding += 1
    try {
      const answer = await $.ui.ask(question, { header: 'Shield', options: [GUARD_OPTIONS.block, GUARD_OPTIONS.run] }).catch(() => undefined)
      const ran = answer === GUARD_OPTIONS.run
      shield = { result: ran ? 'ran' : 'blocked', until: (await $.clock.now()) + GUARD_HOLD_MS }
      stats = recordShield(stats, shield.result)
      if (ran) {
        return { decision: 'allow' as const, reason: 'The user let it run when the oxen-pet shield asked.' }
      }

      return { decision: 'deny' as const, reason: answer === undefined ? UNANSWERED : BLOCKED }
    } finally {
      guarding -= 1
    }
  })

  on('tool.call', async ($, e, next) => {
    // The shield's own question is a call of AskUserQuestion; the pet holds its shield through it.
    if (e.tool.startsWith(OWN_TOOLS) || (guarding > 0 && e.tool === 'AskUserQuestion')) {
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
    const failed = 'deny' in result || ('isError' in result && result.isError === true)
    if (failed) {
      await update($, anim, a => fail(a, lastToolAt))
    }
    stats = recordTool(stats, e.tool, input, failed)
    const outcome = e.tool === 'Bash' && typeof input.command === 'string' && isTestCommand(input.command) ? testOutcome(result) : undefined
    if (outcome) {
      const before = settings.boss ? bossOnScreen(boss, lastToolAt) : undefined
      boss = settings.boss ? bossAfter(before, outcome, lastToolAt) : undefined
      const beat = before !== undefined && before.defeatedAt === undefined && boss?.defeatedAt !== undefined
      stats = recordTest(stats, outcome, beat)
      // The pet cheers over a defeated boss.
      if (beat) {
        const at = lastToolAt
        await update($, anim, a => ({ ...a, mode: 'cheer' as const, since: at }))
      }
      $.ui.invalidate('ui.render')
    }

    return result
  })

  on('tool.call', { tool: PREVIEW_THEME }, async ($, e) => {
    const { theme, path } = e as unknown as { theme?: unknown; path?: unknown }
    const read = readTheme(theme)
    if (read.errors) {
      return { deny: `No preview was written: ${read.errors.join(' ')}` }
    }
    const badPath = await previewWriteError($, path)
    if (badPath !== undefined || typeof path !== 'string') {
      return { deny: `No preview was written: ${badPath}` }
    }
    const preview = animate(read.theme)
    await $.fs.write(path, previewPage(preview, read.notes))
    previewed = theme

    return { result: `Wrote the preview of ${read.theme.name} to ${path}. What is on screen has not changed.\n\n${themeReport(preview, read.notes)}` }
  })

  on('tool.call', { tool: GET_THEME }, async $ => {
    const dir = customDirOf($.plugin.root, settings.customDir)
    const folder = dir === undefined ? '' : `\n\nThe user's own themes go in ${dir} as <name>.theme.json, which updates never touch; /pet theme <name> puts one on screen.`
    const kept = await $.store.get(THEME_KEY)
    if (kept !== undefined) {
      return { result: `The theme set_theme kept:\n\n${JSON.stringify(kept, null, 2)}${folder}` }
    }
    const chosen = await $.store.get(CHOSEN_KEY)
    const name = typeof chosen === 'string' ? chosen : settings.theme
    const theme = await namedTheme($, name, dir).catch(() => namedTheme($, DEFAULT_THEME, undefined))

    return { result: `No theme is kept, so ${name} is on screen. Its theme:\n\n${JSON.stringify(theme, null, 2)}${folder}` }
  })

  on('tool.call', { tool: SET_THEME }, async ($, e) => {
    const given = (e as unknown as { theme?: unknown }).theme
    if (given === undefined && previewed === undefined) {
      return { deny: 'The theme was not set: no preview_theme call in this session to apply. Pass `theme`.' }
    }
    const value = given === undefined ? previewed : given
    if (value === null) {
      await $.store.delete(THEME_KEY)
      await $.store.delete(CHOSEN_KEY)
      body = await keptBody($, settings.theme, settings.customDir)
      $.ui.invalidate('ui.render')

      return { result: 'The default pet is back, for this session and later ones.' }
    }
    const read = readTheme(value)
    if (read.errors) {
      return { deny: `The theme was not set: ${read.errors.join(' ')}` }
    }
    await $.store.set(THEME_KEY, value)
    await $.store.delete(CHOSEN_KEY)
    body = animate(read.theme)
    $.ui.invalidate('ui.render')

    return { result: `The ${read.theme.name} theme is on screen now, for this session and later ones.\n\n${themeReport(body, read.notes)}` }
  })

  // /pet opens the pane with what the session did, and closes it when it is open.
  on('command.run', { command: PET_COMMAND }, async ($, e) => {
    // /pet theme lists the pets; /pet theme <name> puts one on screen, for this session and later ones.
    const [sub, name] = e.args.trim().split(/\s+/)
    if (sub === 'theme') {
      const dir = customDirOf($.plugin.root, settings.customDir)
      if (name === undefined) {
        const own = dir === undefined ? [] : themeNames(await $.fs.list(dir).catch(() => []))
        const kept = await $.store.get(THEME_KEY)
        const chosen = await $.store.get(CHOSEN_KEY)
        return { text: themeList(own, kept !== undefined ? undefined : typeof chosen === 'string' ? chosen : settings.theme, dir) }
      }
      let read: ReturnType<typeof readTheme>
      try {
        read = readTheme(await namedTheme($, name, dir))
      } catch (err) {
        return { text: `${err instanceof Error ? err.message : String(err)} Run /pet theme for the list.` }
      }
      if (read.errors) {
        return { text: `The ${name} theme does not read: ${read.errors.join(' ')}` }
      }
      await $.store.set(CHOSEN_KEY, name)
      await $.store.delete(THEME_KEY)
      body = animate(read.theme)
      $.ui.invalidate('ui.render')
      return { text: `${read.theme.name} is on screen now, and stays for later sessions.` }
    }
    if ((await $.ui.panes()).some(p => p.id === PANE_ID)) {
      await $.ui.close({ id: PANE_ID })
      return {}
    }
    const opened = await $.ui.open({ id: PANE_ID, title: 'oxen-pet', closeOnEscape: true, rows: 10 })
    if (opened.isPlaced) {
      return {}
    }
    // Where no pane shows, the stats print as the command's output.
    const rows = statsRows(stats, await $.clock.now(), hud, settings.targets)

    return { text: rows.map(r => `${r.label}: ${r.value}`).join('\n') }
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE_ID) {
      return next(e)
    }
    if (!body) {
      body = await keptBody($, settings.theme, settings.customDir)
    }
    const now = await $.clock.now()
    const rows = statsRows(stats, now, hud, settings.targets)
    const labelW = Math.max(...rows.map(r => r.label.length))
    const face = composeFace(body, stats.bosses > 0 ? 'star' : 'happy', now)
    const frame = frameColor(body.look.hud)
    if (e.surface === 'terminal') {
      const { Box, Raster, Text } = $.ui.resolve(e)

      return (
        <Box gap={2}>
          <Raster key="face" columns={BODY_W} rows={ROWS} cells={encodeCells(face)} />
          <Box flexDirection="column">
            {rows.map(r => (
              <Box key={r.label}>
                <Text color={frame} bold>{`${r.label.padEnd(labelW)}  `}</Text>
                <Text color={DETAIL_COLOR}>{r.value}</Text>
              </Box>
            ))}
          </Box>
        </Box>
      )
    }
    const { Box, Svg, Text } = $.ui.resolve(e)

    return (
      <Box gap={2}>
        <Svg key="face" source={encodeSvg(face)} alt={`${body.name}, happy`} width={BODY_W * SVG_PX} height={HEIGHT * SVG_PX} />
        <Box flexDirection="column">
          {rows.map(r => (
            <Box key={r.label}>
              <Text color={frame} bold>{`${r.label.padEnd(labelW)}  `}</Text>
              <Text color={DETAIL_COLOR}>{r.value}</Text>
            </Box>
          ))}
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    if (!settings.hud || !hud || e.surface !== 'terminal') {
      return next(e)
    }
    if (!body) {
      body = await keptBody($, settings.theme, settings.customDir)
    }
    const cacheMin = cacheLeftMin(lastTurnEndAt, settings.cacheTtlMin, await $.clock.now())
    const rows = hudRows({ ...hud, cacheMin }, body.look.hud)
    if (rows.length === 0) {
      return next(e)
    }
    const { Box, Raster, Text } = $.ui.resolve(e)
    const frame = frameColor(body.look.hud)
    // Laid in a row when the user asked and the terminal has the room, else stacked.
    const inRow = settings.hudRow ? hudRows({ ...hud, cacheMin }, body.look.hud, true) : []
    const rowW = hudRowWidth(inRow)
    // A row is one line with no window, the bars apart by gaps in the frame's color.
    if (inRow.length > 0 && (e.viewport === undefined || e.viewport.columns >= rowW + 2)) {
      return (
        <Box flexDirection="column">
          {await next(e)}
          <Box key="row" marginLeft={1}>
            {inRow.map((r, k) => (
              <Box key={r.key}>
                {k > 0 && <Text color={frame}>{ROW_GAP}</Text>}
                <Text color={r.color}>{r.label} </Text>
                <Raster key={`bar-${r.key}`} columns={r.bar.w} rows={1} cells={r.cells} />
                {r.parts.map((p, i) => (
                  <Text key={String(i)} color={p.color} bold={p.bold}>
                    {p.text}
                  </Text>
                ))}
              </Box>
            ))}
          </Box>
        </Box>
      )
    }
    const edges = windowEdges(HUD_WINDOW_W)

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
                <Raster key={`bar-${r.key}`} columns={r.bar.w} rows={1} cells={r.cells} />
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
        body = await keptBody($, settings.theme, settings.customDir)
      }
      const a = await read($, anim)
      const now = await $.clock.now()
      const elapsed = now - a.since
      const views = minisOnScreen(minis, now)
      // A leap is the run mode playing the jump clip, slowed, while the pet travels.
      const drawn = a.leap ? { mode: 'jump' as const, ms: leapClipMs((now - a.leap.since) * settings.pace) } : { mode: a.mode, ms: elapsed * settings.pace }
      const picture = compose(body, drawn.mode, drawn.ms, a.dir, hud ? mood(hud) : 'ok', views)
      const extra = views.length > MAX_MINIS ? ` (+${views.length - MAX_MINIS} minis)` : ''
      const shielded = shield !== undefined && guarding === 0 && now < shield.until ? guardLine(shield.result) : undefined
      const noticed = notice !== undefined && now < notice.until ? notice.text : undefined
      const line = settings.statusLine ? (shielded ?? noticed ?? statusLine(a.mode, a.since, elapsed, a.target, body.look.lines[a.mode])) + extra : ''
      const tint = noticed && !shielded ? NOTICE_COLOR : lineColor(a.mode, body.look.lineColors)
      if (showsError) {
        showsError = false
        $.ui.status(undefined)
      }

      const scene = sceneLayout(body)
      const shownBoss = settings.boss ? bossOnScreen(boss, now) : undefined
      const bossArt = shownBoss && drawBoss(shownBoss, now)
      const bossW = bossArt ? BOSS_W + 1 : 0
      if (e.surface === 'terminal' && scene && body.scene) {
        const { Box, Raster, Text } = $.ui.resolve(e)
        const width = scene.width
        const textW = line ? lineWidth(line) + 3 : 0
        const left = Math.max(0, Math.min(Math.round(a.x), width - picture.w - textW - bossW))
        const band = drawBand(body, body.scene, scene, picture, left, now)
        if (bossArt) {
          overlay(band, bossArt, width - bossW)
        }
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
                  <Text color={tint} bold wrap="truncate">
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
        const room = Math.max(0, bodyColumns - picture.w - line.length - 4 - bossW)

        return (
          <Box height={ROWS} width={bandWidth()}>
            <Box marginLeft={Math.min(Math.round(a.x), room)} alignItems="flex-end">
              <Raster key="pet" columns={picture.w} rows={ROWS} cells={encodeCells(picture)} />
              {line && (
                <Box marginBottom={1} marginLeft={1}>
                  <Text color={tint} bold>
                    › {line}
                  </Text>
                </Box>
              )}
            </Box>
            {bossArt && <Box flexGrow={1} />}
            {bossArt && <Raster key="boss" columns={BOSS_W} rows={ROWS} cells={encodeCells(bossArt)} />}
          </Box>
        )
      }
      if (e.surface === 'desktop') {
        // The desktop has no Raster: the pet, its scene and the HUD's bars draw as SVG, and the HUD sits in the band,
        // since the desktop's hint line under the prompt is its own.
        const { Box, Svg, Text } = $.ui.resolve(e)
        const rows = settings.hud && hud ? hudRows({ ...hud, cacheMin: cacheLeftMin(lastTurnEndAt, settings.cacheTtlMin, now) }, body.look.hud, settings.hudRow) : []
        const hudFrame = frameColor(body.look.hud)
        const hudBox = rows.length > 0 && (
          <Box key="hud" flexDirection={settings.hudRow ? 'row' : 'column'} alignSelf="flex-start" {...(settings.hudRow ? {} : { borderStyle: 'round', borderColor: hudFrame, paddingX: 1 })}>
            {rows.map((r, k) => (
              <Box key={r.key} alignItems="center">
                {settings.hudRow && k > 0 && <Text color={hudFrame}>{ROW_GAP}</Text>}
                <Text color={r.color}>{r.label} </Text>
                <Svg source={encodeSvg(r.bar)} alt={`${r.key.toUpperCase()} bar, ${r.pct}% left`} width={r.bar.w * HUD_SVG_PX} height={r.bar.h * HUD_SVG_PX} />
                {r.parts.map((p, i) => (
                  <Text key={String(i)} color={p.color} bold={p.bold}>
                    {p.text}
                  </Text>
                ))}
              </Box>
            ))}
          </Box>
        )
        if (scene && body.scene) {
          const width = Math.min(scene.width, DESKTOP_BAND_W)
          const left = Math.max(0, Math.min(Math.round(a.x), width - picture.w - bossW))
          const band = crop(drawBand(body, body.scene, scene, picture, left, now), 0, 0, width, HEIGHT + GROUND_H)
          if (bossArt) {
            overlay(band, bossArt, width - bossW)
          }

          return (
            <Box flexDirection="column">
              <Svg source={encodeSvg(band)} alt={`${body.name}, ${a.mode}, in its scene`} width={width * SVG_PX} height={band.h * SVG_PX} />
              {line && (
                <Text color={tint} bold>
                  › {line}
                </Text>
              )}
              {hudBox}
            </Box>
          )
        }

        return (
          <Box flexDirection="column">
            <Box alignItems="flex-end">
              <Box marginLeft={Math.round(a.x)}>
                <Svg source={encodeSvg(picture)} alt={`${body.name}, ${a.mode}`} width={picture.w * SVG_PX} height={HEIGHT * SVG_PX} />
              </Box>
              {line && (
                <Text color={tint} bold>
                  {line}
                </Text>
              )}
              {shownBoss && bossArt && <Box flexGrow={1} />}
              {shownBoss && bossArt && <Svg key="boss" source={encodeSvg(bossArt)} alt={bossAlt(shownBoss)} width={BOSS_W * SVG_PX} height={HEIGHT * SVG_PX} />}
            </Box>
            {hudBox}
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
