// Tests for aggregate.mjs: node --test tools/meter/aggregate.test.mjs (Node 22.18 or later).
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerHooks } from 'node:module'
import { test } from 'node:test'

import { aggregate, markdown, readExports } from './aggregate.mjs'

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

/** A Codex session file: no cache writes; its main thread sent its context again in full after 90 minutes. */
function codexFile(sid, startedAt) {
  const s = (at, u) => ({ k: 'step', t0: startedAt + at * MIN, t1: startedAt + at * MIN + 1000, turn: 'turn', idx: 0, thread: 'main', model: 'gpt-6.1-sol', in: u.in, out: 500, cr: u.cr, cw: 0, ctx: u.in + u.cr, msgs: 0, tools: [] })
  const q = (at, used) => ({ k: 'quota', t: startedAt + at * MIN, thread: 'main', windowMin: 10080, used })
  const records = [s(0, { in: 80 * K, cr: 0 }), q(0, 40), s(10, { in: 2 * K, cr: 80 * K }), q(10, 42), s(100, { in: 76 * K, cr: 6.4 * K }), q(100, 43), q(105, 46)]
  const groups = { 'main||gpt-6.1-sol': { steps: 3, in: 158 * K, out: 1500, cr: 86.4 * K, cw: 0 } }
  return { v: 1, sid, tool: 'codex', project: 'p', startedAt, savedAt: startedAt, version: '1.1.0', settings: SETTINGS, dropped: 0, groups, names: {}, timings: {}, records }
}

const DAY1 = Date.UTC(2026, 8, 29, 9) // a Tuesday
const DAY2 = Date.UTC(2026, 9, 6, 9) // the next Tuesday

function exportsDir() {
  const dir = mkdtempSync(join(tmpdir(), 'oxen-meter-aggregate-'))
  const write = (name, label, sessions) =>
    writeFileSync(join(dir, name), JSON.stringify(exportOf(sessions, { label, version: '1.0.0', day: '2026-10-06', days: 30, settings: SETTINGS })))
  write('oxen-meter-export-20261006-an.json', 'an', [{ file: sessionFile('s1', DAY1, true), id: 'aaaa' }, { file: sessionFile('s2', DAY2, false), id: 'bbbb' }])
  write('oxen-meter-export-20261006-binh.json', 'binh', [{ file: sessionFile('s3', DAY2, false), id: 'cccc' }, { file: codexFile('codex-s4', DAY2), id: 'dddd' }])
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
  assert.deepEqual(r.people.map(p => [p.label, p.sessions, p.cold]), [['an', 2, 1], ['binh', 2, 1]])
  assert.deepEqual(r.byAgentType.map(a => a.type), ['Explore', 'main'])
  assert.deepEqual(r.byModel.map(m => m.model), ['claude-sonnet-5-5', 'claude-opus-5-5', 'gpt-6.1-sol'])
  assert.equal(r.coldTop.length, 2)
  assert.deepEqual([r.coldTop[0].label, r.coldTop[0].day, r.coldTop[0].thread, r.coldTop[0].idleMs], ['an', '2026-09-29', 'Explore a1', 66 * MIN])
  assert.deepEqual([r.coldTop[1].label, r.coldTop[1].thread, r.coldTop[1].idleMs, r.coldTop[1].extra], ['binh', 'codex main', 90 * MIN, 68400])
  assert.deepEqual([r.ttl.main.min, r.ttl.subagent.min], [60, 5])
  assert.deepEqual(r.weeks.map(w => [w.week, w.sessions, w.cold]), [['2026-09-28', 1, 1], ['2026-10-05', 3, 1]])
  assert.equal(r.hooks['turn.step'].count, 30)
})

test('the markdown has a section for each part, and names no session by its own id', () => {
  const { exports } = readExports([exportsDir()])
  const md = markdown(aggregate(exports, {}))
  for (const heading of ['# oxen-meter team report', '## By person', '## By tool', '## By agent type', '## By model', '## Top cold resumes', '## TTL', '## Cache after a gap', '## Quota', '## Weekly trend', '## Anti-patterns', '## Handoffs', '## Hook timing']) {
    assert.ok(md.includes(heading), heading)
  }
  assert.match(md, /\| an \| claude \| 2 \|/)
  assert.doesNotMatch(md, /\bs1\b|agent-x/)
})

test('the tools are added up apart, Codex by its gap curve, and the quota each person used by tool and window', () => {
  const { exports } = readExports([exportsDir()])
  const r = aggregate(exports, {})
  assert.deepEqual(r.byTool.map(t => [t.tool, t.sessions]), [['claude', 3], ['codex', 1]])
  assert.deepEqual(r.people.map(p => [p.label, p.tools]), [['an', ['claude']], ['binh', ['claude', 'codex']]])
  assert.deepEqual(Object.keys(r.gaps), ['codex|gpt-6.1'])
  assert.deepEqual(r.people.find(p => p.label === 'binh').quota, { 'codex|10080': 5 })
  const md = markdown(r)
  assert.match(md, /\| codex gpt-6\.1 \|/)
  assert.match(md, /\| binh \| codex 7d \| \+5 \|/)
})

test('the team report makes its --out folder when it is not there yet, as the guide runs it', () => {
  const out = join(mkdtempSync(join(tmpdir(), 'oxen-meter-out-')), 'report')
  const script = new URL('./aggregate.mjs', import.meta.url).pathname
  const r = spawnSync(process.execPath, [script, '--out', out, exportsDir()], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  assert.ok(existsSync(join(out, 'team-report.md')))
  assert.ok(existsSync(join(out, 'team-report.json')))
})

test('cost is Claude Code\'s alone: a person with no Claude Code session shows none, not $0.00, and one person is a person', () => {
  const dir = mkdtempSync(join(tmpdir(), 'oxen-meter-aggregate-'))
  writeFileSync(join(dir, 'oxen-meter-export-20261006-chi.json'), JSON.stringify(exportOf([{ file: codexFile('codex-s5', DAY2), id: 'eeee' }], { label: 'chi', version: '1.1.0', day: '2026-10-06', days: 30, settings: SETTINGS })))
  const md = markdown(aggregate(readExports([dir]).exports, { settings: {} }))
  assert.match(md, /\| chi \| codex \|.*\| — \|$/m)
  assert.match(md, /\| Cost \| none: no Claude Code session \(Codex and Devin report no cost\) \|/)
  const out = join(dir, 'report')
  const r = spawnSync(process.execPath, [new URL('./aggregate.mjs', import.meta.url).pathname, '--out', out, dir], { encoding: 'utf8' })
  assert.match(r.stdout, /^1 session from 1 person;/)
})
