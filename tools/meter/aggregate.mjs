// Builds the team report from oxen-meter exports (/meter export, or the CLI's export), for whoever collects them.
// Run: node tools/meter/aggregate.mjs [--out <folder>] [--cold-tokens <n>] [--output-weight <n>] [--cached-weight <n>]
//        <export file or folder>...
// Writes team-report.md and team-report.json in --out (the current folder by default). Claude Code, Codex and Devin
// sessions all come in through the exports, each person's own.
// Needs Node 22.18 or later: it reads the plugin's own analysis (plugins/oxen-meter/hooks/analyze.ts).
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// The hooks import each other without an extension, as the mod's bundler allows.
registerHooks({ resolve: (spec, ctx, next) => next(/^\.\.?\//.test(spec) && !/\.[a-z]+$/.test(spec) ? `${spec}.ts` : spec, ctx) })
const hooks = new URL('../../plugins/oxen-meter/hooks/', import.meta.url)
const { coldResumes, handoffsOf, hitRate, summarize } = await import(new URL('analyze.ts', hooks).href)
const { agentLabel, fmtDur, fmtTokens, shortModel } = await import(new URL('report.ts', hooks).href)
const { EXPORT_KIND } = await import(new URL('exportFile.ts', hooks).href)
const { TOOLS } = await import(new URL('record.ts', hooks).href)

const TEAM_SETTINGS = { mainTtl: 'auto', subagentTtl: 'auto', coldTokens: 50000, outputWeight: 5, cachedWeight: 0.1 }
const TOP_COLD = 20
const FLAG_KINDS = ['cold-resume', 'context-bloat', 'big-first-prefix', 'expensive-short']

/** The exports among `paths` (files, and the .json files directly in folders), and the files that are not one. */
export function readExports(paths) {
  const exports = []
  const skipped = []
  const files = paths.flatMap(p => (statSync(p).isDirectory() ? readdirSync(p).filter(n => n.endsWith('.json')).map(n => join(p, n)) : [p]))
  for (const file of files) {
    try {
      const e = JSON.parse(readFileSync(file, 'utf8'))
      if (e?.kind === EXPORT_KIND && e.v === 1 && Array.isArray(e.sessions)) {
        exports.push({ ...e, file })
      } else {
        skipped.push(`${file}: not an oxen-meter export`)
      }
    } catch (err) {
      skipped.push(`${file}: ${err.message}`)
    }
  }
  return { exports, skipped }
}

/** The Monday of `day`'s week, YYYY-MM-DD. */
function mondayOf(day) {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}

const median = values => {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length === 0 ? undefined : sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

const byEq = rec => Object.entries(rec).sort((a, b) => b[1].eq - a[1].eq)

/** Each person's sessions, their latest export's copy of each, as summarize reads them. */
function sessionsOf(exports) {
  const latest = new Map()
  for (const e of [...exports].sort((a, b) => a.day.localeCompare(b.day))) {
    for (const s of e.sessions) {
      latest.set(`${e.label}/${s.id}`, { label: e.label, ...s })
    }
  }
  return [...latest.values()].map(s => ({
    label: s.label,
    day: s.startedDay,
    costUsd: s.costUsd ?? 0,
    timings: s.timings ?? {},
    data: { sid: `${s.label}/${s.id}`, startedAt: 0, records: s.records ?? [], groups: s.groups ?? {}, ...(s.tool !== undefined ? { tool: s.tool } : {}) },
  }))
}

/** What the exports add up to: the team, each person, agent type, model and week, the cold resumes, TTLs and hooks. */
export function aggregate(exports, o = {}) {
  const settings = { ...TEAM_SETTINGS, ...(o.settings ?? {}) }
  const sessions = sessionsOf(exports)
  const team = summarize(sessions.map(s => s.data), settings)
  const ttlMin = { main: team.ttl.main.min, subagent: team.ttl.subagent.min }
  const people = [...new Set(sessions.map(s => s.label))].map(label => {
    const own = sessions.filter(s => s.label === label)
    const sum = summarize(own.map(s => s.data), settings)
    const handoffs = own.flatMap(s => handoffsOf(s.data.records))
    return {
      label,
      tools: TOOLS.filter(t => sum.byTool[t] !== undefined),
      quota: sum.quota,
      sessions: own.length,
      steps: sum.totals.steps,
      hit: hitRate(sum.totals),
      eq: sum.eq,
      cold: sum.cold.length,
      coldExtra: sum.cold.reduce((n, c) => n + c.extra, 0),
      costUsd: own.reduce((n, s) => n + s.costUsd, 0),
      flags: Object.fromEntries(FLAG_KINDS.map(k => [k, sum.flags.filter(f => f.kind === k).length])),
      handoffs: {
        agent: handoffs.filter(h => h.kind === 'agent').length,
        codex: handoffs.filter(h => h.kind === 'codex').length,
        resume: handoffs.filter(h => h.kind === 'resume').length,
        backMs: median(handoffs.flatMap(h => (h.workMs !== undefined ? [h.workMs] : []))),
        reactMs: median(handoffs.flatMap(h => (h.reactMs !== undefined ? [h.reactMs] : []))),
      },
    }
  }).sort((a, b) => b.eq - a.eq)
  const coldTop = sessions
    .flatMap(s =>
      coldResumes(s.data.records, ttlMin, settings.coldTokens, { tool: s.data.tool, cachedWeight: settings.cachedWeight }).map(c => ({
        label: s.label,
        day: s.day,
        thread: `${c.tool !== undefined ? `${c.tool} ` : ''}${c.role === 'main' ? (c.model === '' ? 'main (resumed)' : 'main') : agentLabel(c.thread, c.agentType)}`,
        model: c.model,
        idleMs: c.gapMs,
        cw: c.cw,
        extra: c.extra,
      })),
    )
    .sort((a, b) => b.extra - a.extra)
    .slice(0, TOP_COLD)
  const weeks = [...new Set(sessions.map(s => mondayOf(s.day)))].sort().map(week => {
    const own = sessions.filter(s => mondayOf(s.day) === week)
    const sum = summarize(own.map(s => s.data), settings)
    return { week, sessions: own.length, steps: sum.totals.steps, hit: hitRate(sum.totals), eq: sum.eq, cold: sum.cold.length }
  })
  const hooks = {}
  for (const s of sessions) {
    for (const [hook, t] of Object.entries(s.timings)) {
      const h = (hooks[hook] ??= { count: 0, totalMs: 0, maxMs: 0 })
      h.count += t.count
      h.totalMs += t.meanMs * t.count
      h.maxMs = Math.max(h.maxMs, t.maxMs)
    }
  }
  const days = sessions.map(s => s.day).sort()
  const from = days[0] ?? ''
  const to = [...exports.map(e => e.day)].sort().at(-1) ?? from

  return {
    exports: exports.length,
    from,
    to,
    settings,
    team: { sessions: sessions.length, steps: team.totals.steps, hit: hitRate(team.totals), eq: team.eq, mainEq: team.byRole.main.eq, subagentEq: team.byRole.subagent.eq, cold: team.cold.length, coldExtra: team.cold.reduce((n, c) => n + c.extra, 0), costUsd: sessions.reduce((n, s) => n + s.costUsd, 0), keepalive: team.keepalive, compaction: team.compaction },
    people,
    byTool: TOOLS.flatMap(tool => {
      const g = team.byTool[tool]
      return g === undefined ? [] : [{ tool, sessions: g.sessions, steps: g.steps, hit: hitRate(g), eq: g.eq, share: team.eq > 0 ? g.eq / team.eq : 0 }]
    }),
    byAgentType: byEq(team.byAgentType).map(([type, g]) => ({ type, steps: g.steps, hit: hitRate(g), eq: g.eq, share: team.eq > 0 ? g.eq / team.eq : 0 })),
    byModel: byEq(team.byModel).map(([model, g]) => ({ model, steps: g.steps, hit: hitRate(g), eq: g.eq, share: team.eq > 0 ? g.eq / team.eq : 0 })),
    coldTop,
    ttl: team.ttl,
    gaps: team.gaps,
    weeks,
    hooks: Object.fromEntries(Object.entries(hooks).map(([hook, h]) => [hook, { count: h.count, meanMs: h.count > 0 ? h.totalMs / h.count : 0, maxMs: h.maxMs }])),
  }
}

const pct = n => `${Math.round(n * 100)}%`
const windowName = min => (min % 1440 === 0 ? `${min / 1440}d` : min % 60 === 0 ? `${min / 60}h` : `${min}m`)
const spanOf = b => (b.toMin === undefined ? (b.fromMin >= 60 ? `${b.fromMin / 60}h+` : `${b.fromMin}m+`) : b.toMin <= 60 ? `${b.fromMin}–${b.toMin}m` : `${b.fromMin / 60}–${b.toMin / 60}h`)
const usd = n => `$${n.toFixed(2)}`
const ttlName = min => (min >= 60 ? '1h' : '5m')
const row = cells => `| ${cells.join(' | ')} |`
const table = (head, rows) => [row(head), row(head.map(() => '---')), ...rows.map(row)].join('\n')

function ttlText(t) {
  const seen = [t.warm > 0 ? `${t.warm} warm, the longest gap ${fmtDur(t.longestWarmMs ?? 0)}` : '', t.cold > 0 ? `${t.cold} cold, the shortest gap ${fmtDur(t.shortestColdMs ?? 0)}` : ''].filter(Boolean)
  const measured = t.measured['5m'] + t.measured['1h'] > 0 ? `; measured ${t.measured['5m']}× 5m, ${t.measured['1h']}× 1h` : ''
  return `**${t.role}: ${ttlName(t.min)}** (${t.source}). Samples: ${seen.length > 0 ? seen.join('; ') : 'none'}${measured}.`
}

/** The report as Markdown. */
export function markdown(r) {
  const t = r.team
  const flagNames = { 'cold-resume': 'Cold resume', 'context-bloat': 'Context bloat', 'big-first-prefix': 'Big first prefix', 'expensive-short': 'Short task on an expensive model' }
  const lines = [
    '# oxen-meter team report',
    '',
    `From ${r.exports} export${r.exports === 1 ? '' : 's'} by ${r.people.length} ${r.people.length === 1 ? 'person' : 'people'}: ${t.sessions} session${t.sessions === 1 ? '' : 's'}, ${r.from} to ${r.to}. Token equivalents weigh Claude's cache writes 1.25 (5m) or 2 (1h) and reads 0.1, Codex's and Devin's other cached input ${r.settings.cachedWeight}, output ${r.settings.outputWeight}. A cold resume sends at least ${fmtTokens(r.settings.coldTokens)} again: past its TTL in Claude Code, after 5 minutes or more in Codex and Devin.`,
    '',
    '## Summary',
    '',
    table(['', ''], [
      ['Hit rate', pct(t.hit)],
      ['Token equivalent', `${fmtTokens(t.eq)} (main ${fmtTokens(t.mainEq)}, subagent ${fmtTokens(t.subagentEq)})`],
      ['Cold resumes', `${t.cold}, ${fmtTokens(t.coldExtra)} eq beyond a read (${t.eq > 0 ? pct(t.coldExtra / t.eq) : '0%'} of all)`],
      ['Keepalive', t.keepalive.steps > 0 ? `${t.keepalive.steps} pings, ${fmtTokens(t.keepalive.eq)} eq` : 'none'],
      ['Compactions', `${t.compaction.count}${t.compaction.eq > 0 ? `, ${fmtTokens(t.compaction.eq)} eq` : ''}`],
      ['Cost', r.byTool.some(x => x.tool === 'claude') ? `${usd(t.costUsd)}, Claude Code's sessions alone, as /cost totals them (Codex and Devin report no cost)` : 'none: no Claude Code session (Codex and Devin report no cost)'],
    ]),
    '',
    '## By person',
    '',
    table(['Person', 'Tools', 'Sessions', 'Steps', 'Hit', 'Token eq.', 'Cold resumes', 'Cold eq.', 'Cost'], r.people.map(p => [p.label, p.tools.join(', '), p.sessions, p.steps, pct(p.hit), fmtTokens(p.eq), p.cold, fmtTokens(p.coldExtra), p.tools.includes('claude') ? usd(p.costUsd) : '—'])),
    '',
    '## By tool',
    '',
    table(['Tool', 'Sessions', 'Steps', 'Hit', 'Token eq.', 'Share'], r.byTool.map(x => [x.tool, x.sessions, x.steps, pct(x.hit), fmtTokens(x.eq), pct(x.share)])),
    '',
    '## By agent type',
    '',
    table(['Agent type', 'Steps', 'Hit', 'Token eq.', 'Share'], r.byAgentType.map(a => [a.type, a.steps, pct(a.hit), fmtTokens(a.eq), pct(a.share)])),
    '',
    '## By model',
    '',
    table(['Model', 'Steps', 'Hit', 'Token eq.', 'Share'], r.byModel.map(m => [shortModel(m.model), m.steps, pct(m.hit), fmtTokens(m.eq), pct(m.share)])),
    '',
    '## Top cold resumes',
    '',
    r.coldTop.length === 0
      ? 'None.'
      : table(['Person', 'Day', 'Thread', 'Model', 'Idle', 'Written again', 'Beyond a read'], r.coldTop.map(c => [c.label, c.day, c.thread, c.model ? shortModel(c.model) : '', fmtDur(c.idleMs), fmtTokens(c.cw), `${fmtTokens(c.extra)} eq`])),
    '',
    '## TTL',
    '',
    ttlText(r.ttl.main),
    '',
    ttlText(r.ttl.subagent),
    '',
    'A warm sample read its context back after a gap; a cold one wrote it again. Measured TTLs come from Claude Code (an Agent call\'s 5m/1h cache writes, a model switch).',
    '',
    '## Cache after a gap',
    '',
    Object.keys(r.gaps).length === 0
      ? 'No Codex or Devin sample.'
      : table(['Tool and model', ...r.gaps[Object.keys(r.gaps)[0]].map(spanOf)], Object.entries(r.gaps).map(([key, curve]) => [key.replace('|', ' '), ...curve.map(b => (b.warm + b.cold > 0 ? `${b.warm}/${b.warm + b.cold}` : ''))])),
    '',
    'Codex and Devin have no TTL the meter can rely on: each cell is the samples that read their cache back over all the samples, by how long the thread sat.',
    '',
    '## Quota',
    '',
    r.people.every(p => Object.keys(p.quota).length === 0)
      ? 'No rate-limit reading.'
      : table(['Person', 'Window', 'Points used'], r.people.flatMap(p => Object.entries(p.quota).map(([key, points]) => {
        const [tool, windowMin] = key.split('|')
        return [p.label, `${tool} ${windowName(Number(windowMin))}`, `+${Math.round(points * 10) / 10}`]
      }))),
    '',
    'Points of each rate-limit window that moved while the person\'s sessions ran: each rise between readings at most an hour apart. Use outside the sessions in that hour counts too.',
    '',
    '## Weekly trend',
    '',
    table(['Week of', 'Sessions', 'Steps', 'Hit', 'Token eq.', 'Cold resumes'], r.weeks.map(w => [w.week, w.sessions, w.steps, pct(w.hit), fmtTokens(w.eq), w.cold])),
    '',
    '## Anti-patterns',
    '',
    table(['Person', ...FLAG_KINDS.map(k => flagNames[k])], r.people.map(p => [p.label, ...FLAG_KINDS.map(k => p.flags[k])])),
    '',
    '## Handoffs',
    '',
    table(['Person', 'Agent', 'Codex', 'Resumes', 'Median back', 'Median to the next handoff'], r.people.map(p => [p.label, p.handoffs.agent, p.handoffs.codex, p.handoffs.resume, p.handoffs.backMs === undefined ? '' : fmtDur(p.handoffs.backMs), p.handoffs.reactMs === undefined ? '' : fmtDur(p.handoffs.reactMs)])),
    '',
    '## Hook timing',
    '',
    table(['Hook', 'Calls', 'Mean', 'Slowest'], Object.entries(r.hooks).map(([hook, h]) => [hook, h.count, `${h.meanMs.toFixed(2)} ms`, `${h.maxMs.toFixed(2)} ms`])),
  ]
  return `${lines.join('\n')}\n`
}

function main(argv) {
  const opts = { out: '.', settings: {} }
  const paths = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--out') opts.out = argv[++i]
    else if (a === '--cold-tokens') opts.settings.coldTokens = Number(argv[++i])
    else if (a === '--cached-weight') opts.settings.cachedWeight = Number(argv[++i])
    else if (a === '--output-weight') opts.settings.outputWeight = Number(argv[++i])
    else paths.push(a)
  }
  if (paths.length === 0) {
    console.error('usage: node tools/meter/aggregate.mjs [--out <folder>] [--cold-tokens <n>] [--output-weight <n>] [--cached-weight <n>] <export file or folder>...')
    process.exit(1)
  }
  const { exports, skipped } = readExports(paths)
  for (const s of skipped) console.error(`skipped ${s}`)
  if (exports.length === 0) {
    console.error('no oxen-meter export found')
    process.exit(1)
  }
  const report = aggregate(exports, opts)
  mkdirSync(opts.out, { recursive: true })
  writeFileSync(join(opts.out, 'team-report.json'), `${JSON.stringify(report, null, 2)}\n`)
  writeFileSync(join(opts.out, 'team-report.md'), markdown(report))
  const n = report.people.length
  console.log(`${report.team.sessions} session${report.team.sessions === 1 ? '' : 's'} from ${n} ${n === 1 ? 'person' : 'people'}; wrote ${join(opts.out, 'team-report.md')} and team-report.json`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2))
}
