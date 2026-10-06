// Tests for the CLI: node --test tools/meter/oxen-meter.test.mjs (Node 22.18 or later). Every file lives in a temporary
// folder; nothing under the real home folder is read or written.
import assert from 'node:assert/strict'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { run } from './lib/cli.mjs'

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

process.removeAllListeners('warning')
const { DatabaseSync } = await import('node:sqlite')

/** A Devin database as Devin CLI lays it out, with the columns the import reads, in `dir`. */
function devinDb(dir, start) {
  mkdirSync(dir, { recursive: true })
  const db = new DatabaseSync(join(dir, 'sessions.db'))
  db.exec(`create table sessions (id text primary key, working_directory text not null, backend_type text not null, model text not null, agent_mode text not null, created_at integer not null, last_activity_at integer not null, title text, main_chain_id integer, metadata text);
    create table message_nodes (row_id integer primary key autoincrement, session_id text not null, node_id integer not null, parent_node_id integer, chat_message text not null, created_at integer not null, metadata text);`)
  db.prepare('insert into sessions values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run('hallowed-cone', '/Users/me/CANARY_DEVIN_PROJECT', 'windsurf', 'swe-2-high', 'bypass', start, start + 20 * MIN, 'CANARY_TITLE', 5, null)
  const at = ms => new Date(start + ms).toISOString()
  const ask = (model, ms, inp, cr, cw, extra = {}) => ({ role: 'assistant', content: 'CANARY_ANSWER', thinking: { thinking: 'CANARY_THINKING' }, tool_calls: [{ id: 'c1', name: 'exec', arguments: '{"command":"cat CANARY_FILE"}' }], metadata: { request_id: `req-${ms}`, generation_model: model, started_generation_at: at(ms), created_at: at(ms + 2000), metrics: { input_tokens: inp, cache_read_tokens: cr, cache_creation_tokens: cw, output_tokens: 100 }, ...extra } })
  const nodes = [
    { role: 'user', content: 'CANARY_PROMPT', metadata: { is_user_input: true, created_at: at(0) } },
    ask('claude-fable-5-1-medium', 1000, 4, 0, 40000),
    ask('claude-fable-5-1-medium', 285000, 4, 40000, 4, { query_label: 'cache_keepalive' }),
    ask('claude-fable-5-1-medium', 300000, 4, 40000, 900),
    ask('compactor', 600000, 41000, null, null),
  ]
  nodes.forEach((m, i) => db.prepare('insert into message_nodes (session_id, node_id, parent_node_id, chat_message, created_at) values (?, ?, ?, ?, ?)').run('hallowed-cone', i + 1, i === 0 ? null : i, JSON.stringify(m), start))
  return { db, at, ask }
}

test('import reads a Devin session from its database: its steps, its keepalives and its compaction, and none of its text', async () => {
  const h = home()
  const { db } = devinDb(h.flags.devinHome, Date.now() - 3600000)
  db.close()
  const out = await run(['import'], h.flags)
  assert.match(out.text, /Devin: 1 session updated\./)
  const file = JSON.parse(readFileSync(join(h.data, 'sessions', 'devin-hallowed-cone.json'), 'utf8'))
  assert.equal(file.tool, 'devin')
  assert.deepEqual(Object.keys(file.groups).sort(), ['main|compaction|compactor', 'main||claude-fable-5-1-medium'])
  assert.equal(file.groups['main||claude-fable-5-1-medium'].steps, 3)
  assert.equal(file.records.filter(r => r.k === 'step' && r.keepalive).length, 1)
  assert.doesNotMatch(everything(h), /CANARY|\/Users\/me/)
  const report = (await run(['report'], h.flags)).text
  assert.match(report, /Tools {6}codex 1 session, [\d.]+[KM] eq · devin 1 session/)
  assert.match(report, /Keepalive  1 ping/)
})

test('a Devin session is read again only when Devin wrote to it since', async () => {
  const h = home()
  const start = Date.now() - 3600000
  const { db, ask } = devinDb(h.flags.devinHome, start)
  await run(['import'], h.flags)
  assert.match((await run(['import'], h.flags)).text, /Devin: 0 sessions updated\./)
  db.prepare('insert into message_nodes (session_id, node_id, parent_node_id, chat_message, created_at) values (?, ?, ?, ?, ?)').run('hallowed-cone', 6, 5, JSON.stringify(ask('claude-fable-5-1-medium', 900000, 4, 0, 9000)), start)
  db.prepare('update sessions set last_activity_at = ? where id = ?').run(start + 30 * MIN, 'hallowed-cone')
  db.close()
  assert.match((await run(['import'], h.flags)).text, /Devin: 1 session updated\./)
  const file = JSON.parse(readFileSync(join(h.data, 'sessions', 'devin-hallowed-cone.json'), 'utf8'))
  assert.equal(file.groups['main||claude-fable-5-1-medium'].steps, 4)
})

const prompt = h => JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: ROOT_ID, turn_id: 't9', transcript_path: h.rootFile, cwd: '/x', model: 'gpt-6.1-sol', permission_mode: 'default', prompt: 'CANARY_NEXT_PROMPT' })
const settingsWith = (h, options) => {
  writeFileSync(h.flags.claudeSettings, JSON.stringify({ pluginConfigs: { 'oxen-meter@oxen-pet': { options: { userLabel: 'Binh', coldTokens: 10000, ...options } } } }))
  return h.flags
}

test('a prompt into a Codex thread that sat past Cold after warns the user, from the tail of its rollout', async () => {
  const h = home()
  const out = await run(['hook', 'codex'], { ...h.flags, input: prompt(h) })
  assert.equal(out.code, 0)
  assert.match(JSON.parse(out.text).systemMessage, /^oxen-meter: this thread sat 2h00m\. Its 91K context is likely out of the cache/)
  assert.equal((await run(['hook', 'codex'], { ...home(Date.now() - 10 * MIN).flags, input: prompt(home(Date.now() - 10 * MIN)) })).text, '')
  assert.equal((await run(['hook', 'codex'], { ...h.flags, input: JSON.stringify({ ...JSON.parse(prompt(h)), agent_id: 'a1' }) })).text, '')
})

test('in ask mode the prompt is held back once per idle spell, and goes when the user sends it again', async () => {
  const h = home()
  const flags = { ...settingsWith(h, { resumeGuard: 'ask' }), input: prompt(h) }
  const first = JSON.parse((await run(['hook', 'codex'], flags)).text)
  assert.equal(first.decision, 'block')
  assert.match(first.reason, /Press ↑ and Enter to send it anyway/)
  assert.equal((await run(['hook', 'codex'], flags)).text, '')
  assert.equal((await run(['hook', 'codex'], { ...settingsWith(h, { resumeGuard: 'off' }), input: prompt(h) })).text, '')
})

test('a follow-up to a subagent that sat past Cold after warns the user; a message up to the main thread does not', async () => {
  const h = home()
  await run(['import'], h.flags)
  const call = target => JSON.stringify({ hook_event_name: 'PreToolUse', session_id: ROOT_ID, turn_id: 't9', transcript_path: h.rootFile, tool_name: 'collaborationfollowup_task', tool_use_id: 'u1', tool_input: { target, message: 'CANARY' } })
  assert.match(JSON.parse((await run(['hook', 'codex'], { ...h.flags, input: call('/root/review') })).text).systemMessage, /^oxen-meter: reviewer 4e5f sat 2h00m\. Resuming it likely sends its 30K context again/)
  assert.match(JSON.parse((await run(['hook', 'codex'], { ...h.flags, input: call('review') })).text).systemMessage, /reviewer 4e5f sat/)
  assert.equal((await run(['hook', 'codex'], { ...h.flags, input: call('/root') })).text, '')
  const asked = (await run(['hook', 'codex'], { ...settingsWith(h, { resumeGuard: 'ask' }), input: call('/root/review') })).text
  assert.ok(!('decision' in JSON.parse(asked)), 'a tool call is never held back')
})

test('Stop imports the thread that stopped, alone, and the hooks\' own times go with its session', async () => {
  const h = home()
  await run(['hook', 'codex'], { ...h.flags, input: prompt(h) })
  const out = await run(['hook', 'codex'], { ...h.flags, input: JSON.stringify({ hook_event_name: 'Stop', session_id: ROOT_ID, turn_id: 't9', transcript_path: h.rootFile, stop_hook_active: false, last_assistant_message: 'CANARY' }) })
  assert.equal(out.text, '')
  const file = sessionOf(h)
  assert.deepEqual(Object.keys(file.groups), ['main||gpt-6.1-sol'])
  assert.equal(file.timings['codex UserPromptSubmit'].count, 1)
  assert.doesNotMatch(everything(h), /CANARY/)
})

test('a hook given anything it cannot read prints nothing and exits 0', async () => {
  const h = home()
  for (const input of ['', 'not json', '{}', '{"hook_event_name":"UserPromptSubmit","transcript_path":"/nowhere.jsonl","session_id":"x"}']) {
    assert.deepEqual(await run(['hook', 'codex'], { ...h.flags, input }), { code: 0, text: '' })
  }
  assert.deepEqual(await run(['hook', 'devin-later'], { ...h.flags, input: '{}' }), { code: 0, text: '' })
})

test('run as Codex runs it, the hook writes one JSON object to stdout and nothing to stderr', async () => {
  const { spawnSync } = await import('node:child_process')
  const h = home()
  const cli = new URL('./oxen-meter.mjs', import.meta.url).pathname
  const r = spawnSync(process.execPath, [cli, 'hook', 'codex', '--data', h.data, '--claude-settings', h.flags.claudeSettings], { input: prompt(h), encoding: 'utf8' })
  assert.equal(r.status, 0)
  assert.equal(r.stderr, '')
  assert.match(JSON.parse(r.stdout).systemMessage, /^oxen-meter: this thread sat/)
})

test('setup prints the hooks it would add; with --write it adds them beside the user\'s own, keeps a backup, and never twice', async () => {
  const h = home()
  const path = join(h.dir, '.codex', 'hooks.json')
  const theirs = { hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'bash ~/.codex/herdr-agent-state.sh session' }] }] } }
  writeFileSync(path, JSON.stringify(theirs))
  const dry = await run(['setup', 'codex'], h.flags)
  assert.match(dry.text, /would add these hooks/)
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), theirs)
  assert.match((await run(['setup', 'codex'], { ...h.flags, write: true })).text, /no terminal to answer/)
  const wrote = await run(['setup', 'codex'], { ...h.flags, write: true, yes: true })
  assert.match(wrote.text, /Added oxen-meter's hooks .* run \/hooks to review them/s)
  await run(['setup', 'codex'], { ...h.flags, write: true, yes: true })
  const merged = JSON.parse(readFileSync(path, 'utf8'))
  assert.deepEqual(merged.hooks.SessionStart, theirs.hooks.SessionStart)
  assert.deepEqual(Object.keys(merged.hooks).sort(), ['PreToolUse', 'SessionEnd', 'SessionStart', 'Stop', 'SubagentStop', 'UserPromptSubmit'])
  for (const event of ['UserPromptSubmit', 'PreToolUse', 'Stop']) {
    assert.equal(merged.hooks[event].length, 1, event)
  }
  assert.match(merged.hooks.Stop[0].hooks[0].command, /oxen-meter\.mjs" hook codex "--data"/)
  assert.equal(merged.hooks.PreToolUse[0].matcher, '(followup_task|send_message)$')
  assert.ok(existsSync(`${path}.oxen-meter.bak`))
})

test('setup never writes through a link, nor over a hooks file that is not JSON', async () => {
  const h = home()
  const path = join(h.dir, '.codex', 'hooks.json')
  writeFileSync(path, '{ not json')
  assert.match((await run(['setup', 'codex'], { ...h.flags, write: true, yes: true })).text, /is not JSON/)
  assert.equal(readFileSync(path, 'utf8'), '{ not json')
  const elsewhere = join(mkdtempSync(join(tmpdir(), 'oxen-meter-link-')), 'hooks.json')
  writeFileSync(elsewhere, '{}')
  const { unlinkSync } = await import('node:fs')
  unlinkSync(path)
  symlinkSync(elsewhere, path)
  assert.match((await run(['setup', 'codex'], { ...h.flags, write: true, yes: true })).text, /symbolic link/)
  assert.equal(readFileSync(elsewhere, 'utf8'), '{}')
})

const devinPrompt = (sid = 'hallowed-cone') => JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: sid, prompt_id: 'p1', prompt: 'CANARY_DEVIN_PROMPT' })

test('Devin: in ask mode a prompt into a session idle past Cold after is held back once; warn shows nothing, which Devin cannot', async () => {
  const h = home()
  devinDb(h.flags.devinHome, Date.now() - 2 * 3600000).db.close()
  const asked = { ...settingsWith(h, { resumeGuard: 'ask' }), input: devinPrompt() }
  const first = JSON.parse((await run(['hook', 'devin'], asked)).text)
  assert.equal(first.decision, 'block')
  assert.match(first.reason, /^oxen-meter: this thread sat 1h5\dm\. Its 41K context .* Press ↑ and Enter to send it anyway/)
  assert.equal((await run(['hook', 'devin'], asked)).text, '')
  assert.equal((await run(['hook', 'devin'], { ...settingsWith(h, { resumeGuard: 'warn' }), input: devinPrompt() })).text, '')
  assert.equal((await run(['hook', 'devin'], { ...settingsWith(h, { resumeGuard: 'ask' }), input: devinPrompt('no-such-session') })).text, '')
})

test('Devin: a turn\'s end imports its session, and the hooks\' times go with it', async () => {
  const h = home()
  devinDb(h.flags.devinHome, Date.now() - 3600000).db.close()
  await run(['hook', 'devin'], { ...settingsWith(h, { resumeGuard: 'ask' }), input: devinPrompt() })
  assert.equal((await run(['hook', 'devin'], { ...h.flags, input: JSON.stringify({ hook_event_name: 'Stop', session_id: 'hallowed-cone', prompt_id: 'p1', stop_hook_active: false, last_assistant_message: 'CANARY' }) })).text, '')
  const file = JSON.parse(readFileSync(join(h.data, 'sessions', 'devin-hallowed-cone.json'), 'utf8'))
  assert.equal(file.tool, 'devin')
  assert.equal(file.timings['devin UserPromptSubmit'].count, 1)
  assert.equal(existsSync(join(h.data, 'sessions', `codex-${ROOT_ID}.json`)), false)
})

test('setup devin adds its hooks under "hooks" in Devin\'s config, keeping every other setting and a backup', async () => {
  const h = home()
  const dir = join(h.dir, '.config', 'devin')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'config.json')
  writeFileSync(path, JSON.stringify({ agent: { model: 'swe-2-max' }, hooks: { PreToolUse: [{ matcher: 'exec', hooks: [{ type: 'command', command: 'mine' }] }] } }))
  await run(['setup', 'devin'], { ...h.flags, write: true, yes: true })
  await run(['setup', 'devin'], { ...h.flags, write: true, yes: true })
  const merged = JSON.parse(readFileSync(path, 'utf8'))
  assert.deepEqual(merged.agent, { model: 'swe-2-max' })
  assert.deepEqual(merged.hooks.PreToolUse, [{ matcher: 'exec', hooks: [{ type: 'command', command: 'mine' }] }])
  assert.deepEqual(Object.keys(merged.hooks).sort(), ['PreToolUse', 'SessionEnd', 'Stop', 'UserPromptSubmit'])
  assert.equal(merged.hooks.UserPromptSubmit.length, 1)
  assert.match(merged.hooks.Stop[0].hooks[0].command, /oxen-meter\.mjs" hook devin/)
  assert.ok(existsSync(`${path}.oxen-meter.bak`))
})
