import type { EngineInterface, Register, TurnStepResult } from 'claude-code'

import { codexCallOf, outcomeOf } from './codex'
import { addEvent, addStep, agentCallOf, newCollector, stepRecordOf, threadOf } from './record'
import type { Collector } from './record'
import { COLORS, paneRows, rowsText } from './report'
import type { LiveAgent } from './report'
import { readSettings, ttlMinOf } from './settings'
import { noteTiming } from './timing'

const COMMAND = 'meter'
const PANE_ID = 'meter'
const TICK_MS = 15000 // how often an open pane redraws, so its minutes move

/** The session's agents as the pane needs them, or none when the list call fails. */
async function liveAgents($: EngineInterface): Promise<LiveAgent[]> {
  try {
    return (await $.agent.list()).map(a => ({ id: a.id, status: a.status }))
  } catch {
    return []
  }
}

/** The pane's rows now, for `c` with the TTLs in `ttlMin`. */
async function rowsNow($: EngineInterface, c: Collector, ttlMin: { main: number; subagent: number }) {
  return paneRows(c, await liveAgents($), (await nowOr($)) ?? 0, ttlMin)
}

/** Now, or undefined when the clock call fails: a hook that cannot read the time records nothing and goes on. */
async function nowOr($: EngineInterface) {
  try {
    return await $.clock.now()
  } catch {
    return undefined
  }
}

export const register: Register = (on, options) => {
  const settings = readSettings(options)
  const c = newCollector()
  const ttlMin = () => ({ main: ttlMinOf(settings.mainTtl, 'main'), subagent: ttlMinOf(settings.subagentTtl, 'subagent') })
  let paneOpen = false

  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({ name: COMMAND, description: 'oxen-meter: open or close the prompt cache pane', immediate: true })
    } catch {
      // Without the command the meter still records; only the pane is missing.
    }
    $.clock.every(TICK_MS, () => {
      if (paneOpen) {
        $.ui.invalidate('ui.render')
      }
    })

    return next(e)
  })

  // Every model request of every loop: passed on untouched, then recorded from its usage. Never rewritten or answered.
  on('turn.step', async function* ($, e, next) {
    let mark = performance.now()
    const t0 = await nowOr($)
    let own = performance.now() - mark
    let result: TurnStepResult | undefined
    try {
      result = yield* next(e)
      return result
    } finally {
      mark = performance.now()
      const t1 = await nowOr($)
      try {
        if (t0 !== undefined && t1 !== undefined) {
          addStep(c, stepRecordOf(e, result, t0, t1, c))
        }
      } catch {
        // A step the meter cannot record goes on as the engine sent it.
      }
      own += performance.now() - mark
      noteTiming(c.timings, 'turn.step', own)
    }
  })

  // A Bash call: a Codex handoff or an outcome, by the command's text, which is never kept.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const mark = performance.now()
    let codex: ReturnType<typeof codexCallOf>
    let outcome: ReturnType<typeof outcomeOf>
    try {
      codex = codexCallOf(e.command)
      outcome = outcomeOf(e.command)
    } catch {
      return next(e)
    }
    if (!codex && !outcome) {
      noteTiming(c.timings, 'tool.call', performance.now() - mark)
      return next(e)
    }
    const t0 = await nowOr($)
    const result = await next(e)
    const t1 = await nowOr($)
    try {
      const thread = threadOf(e.agentId)
      const failed = 'deny' in result || result.isError === true
      const bg = e.run_in_background === true || (!failed && result.result?.backgroundTaskId !== undefined)
      if (codex && t0 !== undefined && t1 !== undefined) {
        addEvent(c, { k: 'codex', t0, t1, thread, sub: codex.sub, ...(bg ? { bg: true as const } : {}), ...(failed ? { failed: true as const } : {}) })
      }
      if (outcome && !failed && t1 !== undefined) {
        addEvent(c, { k: 'outcome', t: t1, thread, outcome })
      }
    } catch {
      // The call's result stands whatever the meter makes of it.
    }
    noteTiming(c.timings, 'tool.call', performance.now() - mark)

    return result
  })

  // An Agent call: the agent it started, its type and model, and the TTL its cache writes used.
  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    const t0 = await nowOr($)
    const result = await next(e)
    const mark = performance.now()
    const t1 = await nowOr($)
    try {
      if (t0 !== undefined && t1 !== undefined) {
        const records = agentCallOf('deny' in result ? undefined : result.result, t0, t1, threadOf(e.agentId))
        for (const r of records) {
          addEvent(c, r)
        }
        const started = records[0]?.k === 'agent-call' ? records[0].agent : undefined
        if (typeof e.name === 'string' && e.name !== '' && started !== undefined) {
          c.names[e.name] = started
        }
      }
    } catch {
      // The call's result stands whatever the meter makes of it.
    }
    noteTiming(c.timings, 'tool.call', performance.now() - mark)

    return result
  })

  on('classic.SubagentStart', async ($, e, next) => {
    const t = await nowOr($)
    if (t !== undefined && typeof e.agent_id === 'string') {
      addEvent(c, { k: 'agent-start', t, thread: e.agent_id, agentType: String(e.agent_type ?? '') })
    }
    return next(e)
  })

  on('classic.SubagentStop', async ($, e, next) => {
    const t = await nowOr($)
    if (t !== undefined && typeof e.agent_id === 'string') {
      addEvent(c, { k: 'agent-stop', t, thread: e.agent_id, agentType: String(e.agent_type ?? '') })
    }
    return next(e)
  })

  // A compaction: passed on untouched, then recorded with its sizes and the summarizer's tokens.
  on('session.compact', async ($, e, next) => {
    if (e.trigger === 'precompute') {
      return next(e)
    }
    const t0 = await nowOr($)
    const stepsBefore = c.stepsInCompaction
    c.compacting += 1
    let result: Awaited<ReturnType<typeof next>>
    try {
      result = await next(e)
    } finally {
      c.compacting -= 1
    }
    const t1 = await nowOr($)
    if (result.skip === undefined && t0 !== undefined && t1 !== undefined) {
      const u = result.usage
      addEvent(c, {
        k: 'compact',
        t0,
        t1,
        thread: threadOf(e.agentId),
        trigger: e.trigger,
        ...(result.tokensBefore !== undefined ? { before: result.tokensBefore } : {}),
        ...(result.tokensAfter !== undefined ? { after: result.tokensAfter } : {}),
        ...(u ? { usage: { in: u.input_tokens, out: u.output_tokens, cr: u.cache_read_input_tokens, cw: u.cache_creation_input_tokens } } : {}),
        stepsSeen: c.stepsInCompaction - stepsBefore,
      })
    }

    return result
  })

  // /meter opens the pane, and closes it when it is open. Where no pane shows, the rows print as the command's output.
  on('command.run', { command: COMMAND }, async $ => {
    if ((await $.ui.panes()).some(p => p.id === PANE_ID)) {
      await $.ui.close({ id: PANE_ID })
      paneOpen = false
      return {}
    }
    const opened = await $.ui.open({ id: PANE_ID, title: 'oxen-meter', closeOnEscape: true, rows: 14 })
    paneOpen = opened.isPlaced
    if (opened.isPlaced) {
      return {}
    }

    return { text: rowsText(await rowsNow($, c, ttlMin())) }
  })

  // Text alone, so the pane draws alike on a terminal and on the desktop.
  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE_ID) {
      return next(e)
    }
    const rows = await rowsNow($, c, ttlMin())
    const labelW = Math.max(...rows.map(r => r.label.length))
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        {rows.map(r => (
          <Box key={r.label}>
            <Text color={COLORS.label} bold>{`${r.label.padEnd(labelW)}  `}</Text>
            <Text color={r.color ?? COLORS.detail}>{r.value}</Text>
          </Box>
        ))}
      </Box>
    )
  })
}
