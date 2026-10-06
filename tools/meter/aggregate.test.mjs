// Tests for aggregate.mjs: node --test tools/meter/aggregate.test.mjs (Node 22.18 or later).
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerHooks } from 'node:module'
import { test } from 'node:test'

import { aggregate, markdown, readCodex, readExports } from './aggregate.mjs'

registerHooks({ resolve: (spec, ctx, next) => next(/^\.\.?\//.test(spec) && !/\.[a-z]+$/.test(spec) ? `${spec}.ts` : spec, ctx) })
const { exportOf } = await import(new URL('../../plugins/oxen-meter/hooks/exportFile.ts', import.meta.url).href)

const MIN = 60000
const K = 1000
const SETTINGS = { mainTtl: 'auto', subagentTtl: 'auto', coldTokens: 50000, outputWeight: 5 }

const step = (thread, at, u, type) => ({ k: 'step', t0: at * MIN, t1: at * MIN + 1000, turn: 'turn', idx: 0, thread, ...(type ? { agentType: type } : {}), model: thread === 'main' ? 'claude-opus-5-5' : 'claude-sonnet-5-5', in: 500, out: 800, cr: u.cr ?? 0, cw: u.cw ?? 0, ctx: 500 + (u.cr ?? 0) + (u.cw ?? 0), msgs: 4 + at, tools: [] })

/** A session file: main warm throughout; an Explore subagent cold after an hour when `cold`. */
function sessionFile(sid, startedAt, cold) {
  const records = [
    step('main', 0, { cw: 40 * K }),
    step('main', 2, { cr: 40 * K, cw: 1 * K }),
    { k: 'agent-start', t: 3 * MIN, thread: 'agent-x', agentType: 'Explore' },
    step('agent-x', 3, { cw: 120 * K }, 'Explore'),
    step('agent-x', 4, { cr: 120 * K, cw: 2 * K }, 'Explore'),
    ...(cold ? [step('agent-x', 70, { cw: 122 * K }, 'Explore')] : []),
  ].map(r => ('t0' in r ? { ...r, t0: r.t0 + startedAt, t1: r.t1 + startedAt } : { ...r, t: r.t + startedAt }))
  const groups = {
    'main||claude-opus-5-5': { steps: 2, in: 1000, out: 1600, cr: 40 * K, cw: 41 * K },
    'subagent|Explore|claude-sonnet-5-5': { steps: cold ? 3 : 2, in: 1500, out: 2400, cr: 120 * K, cw: (cold ? 244 : 122) * K },
  }
  return { v: 1, sid, project: 'p', startedAt, savedAt: startedAt, version: '1.0.0', settings: SETTINGS, costUsd: 1.25, dropped: 0, groups, names: {}, timings: { 'turn.step': { count: 10, meanMs: 0.1, p95Ms: 0.2, maxMs: 0.5 } }, records }
}

const DAY1 = Date.UTC(2026, 8, 29, 9) // a Tuesday
const DAY2 = Date.UTC(2026, 9, 6, 9) // the next Tuesday

function exportsDir() {
  const dir = mkdtempSync(join(tmpdir(), 'oxen-meter-aggregate-'))
  const write = (name, label, sessions) =>
    writeFileSync(join(dir, name), JSON.stringify(exportOf(sessions, { label, version: '1.0.0', day: '2026-10-06', days: 30, settings: SETTINGS })))
  write('oxen-meter-export-20261006-an.json', 'an', [{ file: sessionFile('s1', DAY1, true), id: 'aaaa' }, { file: sessionFile('s2', DAY2, false), id: 'bbbb' }])
  write('oxen-meter-export-20261006-binh.json', 'binh', [{ file: sessionFile('s3', DAY2, false), id: 'cccc' }])
  writeFileSync(join(dir, 'notes.json'), '{"hello":1}')
  return dir
}

test('the exports in a folder are read, and a file that is not one is named and skipped', () => {
  const { exports, skipped } = readExports([exportsDir()])
  assert.deepEqual(exports.map(e => e.label).sort(), ['an', 'binh'])
  assert.equal(skipped.length, 1)
  assert.match(skipped[0], /notes\.json/)
})

test('the report has each person, each agent type and model, the cold resumes, the TTLs and a row a week', () => {
  const { exports } = readExports([exportsDir()])
  const r = aggregate(exports, {})
  assert.deepEqual(r.people.map(p => [p.label, p.sessions, p.cold]), [['an', 2, 1], ['binh', 1, 0]])
  assert.deepEqual(r.byAgentType.map(a => a.type), ['Explore', 'main'])
  assert.deepEqual(r.byModel.map(m => m.model), ['claude-sonnet-5-5', 'claude-opus-5-5'])
  assert.equal(r.coldTop.length, 1)
  assert.deepEqual([r.coldTop[0].label, r.coldTop[0].day, r.coldTop[0].thread, r.coldTop[0].idleMs], ['an', '2026-09-29', 'Explore a1', 66 * MIN])
  assert.deepEqual([r.ttl.main.min, r.ttl.subagent.min], [60, 5])
  assert.deepEqual(r.weeks.map(w => [w.week, w.sessions, w.cold]), [['2026-09-28', 1, 1], ['2026-10-05', 2, 0]])
  assert.equal(r.hooks['turn.step'].count, 30)
})

test('the markdown has a section for each part, and names no session by its own id', () => {
  const { exports } = readExports([exportsDir()])
  const md = markdown(aggregate(exports, {}))
  for (const heading of ['# oxen-meter team report', '## By person', '## By agent type', '## By model', '## Top cold resumes', '## TTL', '## Weekly trend', '## Anti-patterns', '## Handoffs', '## Hook timing']) {
    assert.ok(md.includes(heading), heading)
  }
  assert.match(md, /\| an \| 2 \|/)
  assert.doesNotMatch(md, /\bs1\b|agent-x/)
})

test('Codex sessions add up their last token count, in the exports\' days only', () => {
  const dir = mkdtempSync(join(tmpdir(), 'oxen-meter-codex-'))
  const day = (d, lines) => {
    mkdirSync(join(dir, '2026', '10', d), { recursive: true })
    writeFileSync(join(dir, '2026', '10', d, `rollout-2026-10-${d}T10-00-00-x.jsonl`), lines.map(l => JSON.stringify(l)).join('\n'))
  }
  const count = (input, cached, output) => ({ type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: output } } } })
  day('05', [{ type: 'session_meta', payload: { cwd: '/secret' } }, count(100, 50, 10), count(1000, 800, 40), { type: 'event_msg', payload: { type: 'token_count', info: null } }])
  day('06', [count(500, 100, 5)])
  day('20', [count(9999, 9999, 9999)])
  assert.deepEqual(readCodex(dir, '2026-10-01', '2026-10-06'), { sessions: 2, input: 1500, cached: 900, output: 45 })
  assert.equal(readCodex(join(dir, 'missing'), '2026-10-01', '2026-10-06'), undefined)
})
