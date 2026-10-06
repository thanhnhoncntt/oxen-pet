// Tests for the CLI: node --test tools/meter/oxen-meter.test.mjs (Node 22.18 or later). Every file lives in a temporary
// folder; nothing under the real home folder is read or written.
import assert from 'node:assert/strict'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { run } from './oxen-meter.mjs'

const MIN = 60000
const ROOT_ID = '01a10f34-8859-7e71-b716-87d71c201fe1'
const CHILD_ID = '01a10f36-1b3b-74d4-9c6e-0a1b2c3d4e5f'

let ordinal = 0
const line = (at, type, payload) => `${JSON.stringify({ timestamp: new Date(at).toISOString(), ordinal: ordinal++, type, payload })}\n`
const usage = (thread, turn, response, input, cached, output = 300) => ({ thread_id: thread, session_id: ROOT_ID, turn_id: turn, response_id: response, usage: { input_tokens: input, cached_input_tokens: cached, cache_write_input_tokens: 0, output_tokens: output, total_tokens: input + output } })

/** A home folder with a Codex session (its main thread and a subagent) and a data folder, all temporary. */
function home(start = Date.now() - 2 * 3600000) {
  const dir = mkdtempSync(join(tmpdir(), 'oxen-meter-cli-'))
  const day = join(dir, '.codex', 'sessions', '2026', '10', '06')
  mkdirSync(day, { recursive: true })
  const rootFile = join(day, `rollout-2026-10-06T10-00-00-${ROOT_ID}.jsonl`)
  writeFileSync(rootFile, [
    line(start, 'session_meta', { id: ROOT_ID, session_id: ROOT_ID, cwd: '/Users/me/CANARY_PROJECT', source: 'cli', base_instructions: 'CANARY_INSTRUCTIONS' }),
    line(start, 'event_msg', { type: 'task_started', turn_id: 't1' }),
    line(start + 500, 'response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'CANARY_PROMPT' }] }),
    line(start + 500, 'turn_context', { model: 'gpt-6.1-sol', effort: 'medium', cwd: '/Users/me/CANARY_PROJECT' }),
    line(start + 4000, 'response_item', { type: 'function_call', name: 'spawn_agent', arguments: JSON.stringify({ task_name: 'review', agent_type: 'reviewer', message: 'CANARY_TASK' }) }),
    line(start + 4100, 'token_usage_record', usage(ROOT_ID, 't1', 'r1', 90000, 6400)),
    line(start + 5000, 'response_item', { type: 'function_call_output', output: 'CANARY_OUTPUT' }),
    line(start + 5000, 'event_msg', { type: 'token_count', info: {}, rate_limits: { primary: { used_percent: 40, window_minutes: 10080, resets_at: 1791603396 } } }),
    line(start + 9100, 'token_usage_record', usage(ROOT_ID, 't1', 'r2', 91000, 90000)),
    line(start + 9200, 'event_msg', { type: 'task_complete', turn_id: 't1', last_agent_message: 'CANARY_ANSWER' }),
  ].join(''))
  writeFileSync(join(day, `rollout-2026-10-06T10-00-05-${CHILD_ID}.jsonl`), [
    line(start + 4500, 'session_meta', { id: CHILD_ID, session_id: ROOT_ID, cwd: '/Users/me/CANARY_PROJECT', parent_thread_id: ROOT_ID, agent_path: '/root/review', agent_role: 'reviewer', source: { subagent: { thread_spawn: { agent_nickname: 'CANARY_NICK' } } } }),
    line(start + 4600, 'turn_context', { model: 'gpt-6.1-sol', effort: 'low' }),
    line(start + 4600, 'event_msg', { type: 'task_started', turn_id: 'c1' }),
    line(start + 8000, 'token_usage_record', usage(CHILD_ID, 'c1', 'c-1', 30000, 0)),
    line(start + 8100, 'event_msg', { type: 'task_complete', turn_id: 'c1' }),
  ].join(''))
  const claudeSettings = join(dir, 'settings.json')
  writeFileSync(claudeSettings, JSON.stringify({ pluginConfigs: { 'oxen-meter@oxen-pet': { options: { userLabel: 'Binh', coldTokens: 10000 } } } }))
  const data = join(dir, 'meter')
  return { dir, data, rootFile, start, flags: { home: dir, data, claudeSettings, codexHome: join(dir, '.codex'), devinHome: join(dir, 'no-devin') } }
}

const sessionOf = h => JSON.parse(readFileSync(join(h.data, 'sessions', `codex-${ROOT_ID}.json`), 'utf8'))
const everything = h => [join(h.data, 'sessions'), join(h.data, 'state'), join(h.data, 'exports')].flatMap(d => (existsSync(d) ? readdirSync(d).map(n => readFileSync(join(d, n), 'utf8')) : [])).join('\n')

test('import puts a Codex session, its main thread and its subagent, into one session file of the tool codex', async () => {
  const h = home()
  const out = await run(['import'], h.flags)
  assert.equal(out.code, 0)
  assert.match(out.text, /Codex: 2 files read \(\d+\.\d MB\), 1 session updated\./)
  const file = sessionOf(h)
  assert.equal(file.tool, 'codex')
  assert.deepEqual(Object.keys(file.groups).sort(), ['main||gpt-6.1-sol', 'subagent|reviewer|gpt-6.1-sol'])
  assert.equal(file.groups['main||gpt-6.1-sol'].steps, 2)
  assert.match(file.project, /^[0-9a-f]{12}$/)
  assert.equal(file.startedAt, h.start)
  assert.ok(existsSync(join(h.data, 'state', 'salt.json')))
  assert.equal(file.records.find(r => r.k === 'agent-call').agent, CHILD_ID)
})

test('a second import reads only what Codex added since, and never counts a step twice', async () => {
  const h = home()
  await run(['import'], h.flags)
  assert.match((await run(['import'], h.flags)).text, /Codex: 0 files read \(0\.0 MB\), 0 sessions updated\./)
  appendFileSync(h.rootFile, [
    line(h.start + 70 * MIN, 'event_msg', { type: 'task_started', turn_id: 't2' }),
    line(h.start + 70 * MIN + 1000, 'event_msg', { type: 'user_message', message: 'CANARY_LATER' }),
    line(h.start + 70 * MIN + 5000, 'token_usage_record', usage(ROOT_ID, 't2', 'r3', 92000, 6400)),
    line(h.start + 70 * MIN + 5100, 'event_msg', { type: 'task_complete', turn_id: 't2' }),
  ].join(''))
  assert.match((await run(['import'], h.flags)).text, /Codex: 1 file read/)
  const file = sessionOf(h)
  assert.equal(file.groups['main||gpt-6.1-sol'].steps, 3)
  assert.equal(file.records.filter(r => r.k === 'step' && r.thread === 'main').length, 3)
})

test('nothing the user or the model wrote, nor the project\'s folder, reaches the data folder', async () => {
  const h = home()
  await run(['import'], h.flags)
  await run(['report'], h.flags)
  await run(['export'], h.flags)
  const kept = everything(h)
  assert.ok(kept.length > 1000)
  assert.doesNotMatch(kept, /CANARY|\/Users\/me/)
})

test('the report adds Codex up beside Claude Code\'s sessions, cold resumes and quota included', async () => {
  const h = home()
  const out = await run(['report'], h.flags)
  assert.equal(out.code, 0)
  assert.match(out.text, /1 session in the last 7 days/)
  assert.match(out.text, /Tools {6}codex 1 session/)
  assert.match(out.text, /Models {5}gpt-6\.1-sol/)
})

test('the export writes the sessions, anonymized, under the label the user set in Claude Code', async () => {
  const h = home()
  const out = await run(['export'], h.flags)
  assert.match(out.text, /Wrote 1 session of the last 30 days to .*oxen-meter-export-\d{8}-binh\.json/)
  const [name] = readdirSync(join(h.data, 'exports'))
  const e = JSON.parse(readFileSync(join(h.data, 'exports', name), 'utf8'))
  assert.equal(e.label, 'Binh')
  assert.equal(e.sessions[0].tool, 'codex')
  assert.match(e.sessions[0].id, /^[0-9a-f]{12}$/)
  assert.doesNotMatch(JSON.stringify(e), new RegExp(ROOT_ID))
})

test('while another import holds the lock, import reads nothing; a lock left a while ago is taken over', async () => {
  const h = home()
  mkdirSync(join(h.data, 'state'), { recursive: true })
  const lock = join(h.data, 'state', 'codex.lock')
  writeFileSync(lock, '1')
  assert.match((await run(['import'], h.flags)).text, /another import is running/)
  const old = (Date.now() - 5 * MIN) / 1000
  utimesSync(lock, old, old)
  assert.match((await run(['import'], h.flags)).text, /Codex: 2 files read/)
  assert.equal(existsSync(lock), false)
})

test('a data folder whose sessions folder is a link elsewhere is never written through', async () => {
  const h = home()
  const elsewhere = mkdtempSync(join(tmpdir(), 'oxen-meter-elsewhere-'))
  mkdirSync(h.data, { recursive: true })
  symlinkSync(elsewhere, join(h.data, 'sessions'))
  await assert.rejects(run(['import'], h.flags), /symbolic link/)
  assert.deepEqual(readdirSync(elsewhere), [])
})

test('a rollout file last written before the days asked for is not read', async () => {
  const h = home(Date.now() - 40 * 86400000)
  for (const f of readdirSync(join(h.dir, '.codex', 'sessions', '2026', '10', '06'))) {
    const old = (Date.now() - 40 * 86400000) / 1000
    utimesSync(join(h.dir, '.codex', 'sessions', '2026', '10', '06', f), old, old)
  }
  assert.match((await run(['import'], h.flags)).text, /Codex: 0 files read/)
})

test('an unknown command prints the usage', async () => {
  const h = home()
  const out = await run(['nope'], h.flags)
  assert.equal(out.code, 1)
  assert.match(out.text, /^usage:/)
})

test('the report counts a session by when it last ran, though the import wrote its file today', async () => {
  const h = home(Date.now() - 20 * 86400000)
  assert.match((await run(['report', '7'], h.flags)).text, /No session in the last 7 days\./)
  assert.match((await run(['report', '30'], h.flags)).text, /1 session in the last 30 days/)
})
