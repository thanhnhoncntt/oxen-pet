import { expect, test } from 'claude-code/testing'

import { applyCodexOps, codexLine, newCodexState, resolveCodex } from './codexLog'
import type { CodexOp, CodexState } from './codexLog'
import { MAIN, newCollector } from './record'

const MIN = 60000
const START = Date.UTC(2026, 9, 6, 9, 0)
const ROOT = '01a10f34-8859-7e71-b716-87d71c201fe1'
const CHILD = '01a10f36-1b3b-74d4-9c6e-0a1b2c3d4e5f'

let ordinal = 0
/** One rollout line as Codex writes it: the time, an ordinal, the type, then the payload with its own type first. */
const line = (ms: number, type: string, payload: Record<string, unknown>) => JSON.stringify({ timestamp: new Date(START + ms).toISOString(), ordinal: ordinal++, type, payload })
const usage = (thread: string, turn: string, response: string, input: number, cached: number, output = 300) => ({
  thread_id: thread, session_id: ROOT, turn_id: turn, root_turn_id: turn, response_id: response,
  usage: { input_tokens: input, cached_input_tokens: cached, cache_write_input_tokens: 0, output_tokens: output, reasoning_output_tokens: 100, total_tokens: input + output },
})
const limits = (used: number) => ({ type: 'token_count', info: { total_token_usage: { input_tokens: 1 }, last_token_usage: { input_tokens: 1 } }, rate_limits: { limit_id: 'codex', primary: { used_percent: used, window_minutes: 10080, resets_at: 1791603396 }, secondary: null, plan_type: 'prolite' } })
const call = (name: string, args: Record<string, unknown>) => ({ type: 'function_call', id: 'fc_1', name, arguments: JSON.stringify(args), call_id: 'call_1' })

/** The root thread: two warm steps, a subagent started, 90 minutes away, a cold step, a compaction, a follow-up task. */
const ROOT_LINES = [
  line(0, 'session_meta', { id: ROOT, session_id: ROOT, timestamp: 'x', cwd: '/Users/me/CANARY_PROJECT', originator: 'codex-tui', cli_version: '0.160.1', source: 'cli', base_instructions: 'CANARY_INSTRUCTIONS', creator_user_id: 'user-CANARY' }),
  line(0, 'event_msg', { type: 'task_started', turn_id: 'turn-1', model_context_window: 258400 }),
  line(500, 'response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'CANARY_PROMPT' }] }),
  line(500, 'turn_context', { turn_id: 'turn-1', cwd: '/Users/me/CANARY_PROJECT', model: 'gpt-6.1-sol', effort: 'medium' }),
  line(3000, 'response_item', { type: 'reasoning', summary: [], encrypted_content: 'CANARY_THINKING' }),
  line(4000, 'response_item', call('exec', { cmd: 'cat CANARY_FILE' })),
  line(4100, 'token_usage_record', usage(ROOT, 'turn-1', 'resp-1', 20000, 6400)),
  line(5000, 'response_item', { type: 'function_call_output', call_id: 'call_1', output: 'CANARY_OUTPUT' }),
  line(5000, 'event_msg', limits(40)),
  line(9000, 'response_item', call('spawn_agent', { task_name: 'review_auth', agent_type: 'code-reviewer', message: 'CANARY_TASK', model: 'gpt-6.1-sol' })),
  line(9100, 'token_usage_record', usage(ROOT, 'turn-1', 'resp-2', 21000, 20000, 200)),
  line(9200, 'response_item', { type: 'function_call_output', call_id: 'call_1', output: 'CANARY_SPAWNED' }),
  line(10000, 'event_msg', { type: 'task_complete', turn_id: 'turn-1', last_agent_message: 'CANARY_ANSWER' }),
  line(90 * MIN, 'event_msg', { type: 'task_started', turn_id: 'turn-2' }),
  line(90 * MIN + 1000, 'event_msg', { type: 'user_message', message: 'CANARY_PROMPT_2' }),
  line(90 * MIN + 5000, 'token_usage_record', usage(ROOT, 'turn-2', 'resp-3', 22000, 6400)),
  line(90 * MIN + 20000, 'token_usage_record', usage(ROOT, 'turn-2', 'resp-4', 22500, 21000, 1500)),
  line(90 * MIN + 20100, 'compacted', { message: '', replacement_history: [{ text: 'CANARY_HISTORY' }], window_number: 2, compaction_response_id: 'resp-4' }),
  line(90 * MIN + 21000, 'event_msg', limits(43)),
  line(90 * MIN + 30000, 'response_item', call('followup_task', { target: '/root/review_auth', message: 'CANARY_FOLLOWUP' })),
  line(90 * MIN + 31000, 'token_usage_record', usage(ROOT, 'turn-2', 'resp-5', 9000, 8000)),
  line(90 * MIN + 31100, 'event_msg', { type: 'task_complete', turn_id: 'turn-2' }),
]

/** The subagent: its own meta first, then the parent's copied; a message up to its parent; two tasks. */
const CHILD_LINES = [
  line(9500, 'session_meta', { id: CHILD, session_id: ROOT, cwd: '/Users/me/CANARY_PROJECT', source: { subagent: { thread_spawn: { parent_thread_id: ROOT, depth: 1, agent_path: '/root/review_auth', agent_nickname: 'CANARY_NICK', agent_role: 'code-reviewer' } } }, parent_thread_id: ROOT, agent_path: '/root/review_auth', agent_role: 'code-reviewer', forked_from_id: ROOT }),
  line(9500, 'session_meta', { id: ROOT, session_id: ROOT, cwd: '/Users/me/CANARY_PROJECT', source: 'cli' }),
  line(9600, 'turn_context', { model: 'gpt-6.1-sol', effort: 'low' }),
  line(9600, 'event_msg', { type: 'task_started', turn_id: 'turn-c1' }),
  line(15000, 'token_usage_record', usage(CHILD, 'turn-c1', 'c-1', 15000, 0)),
  line(16000, 'response_item', call('send_message', { target: '/root', message: 'CANARY_REPORT' })),
  line(17000, 'token_usage_record', usage(CHILD, 'turn-c1', 'c-2', 16000, 15000)),
  line(18000, 'event_msg', { type: 'task_complete', turn_id: 'turn-c1' }),
  line(90 * MIN + 31000, 'event_msg', { type: 'task_started', turn_id: 'turn-c2' }),
  line(90 * MIN + 40000, 'token_usage_record', usage(CHILD, 'turn-c2', 'c-3', 17000, 6400)),
  line(90 * MIN + 45000, 'event_msg', { type: 'task_complete', turn_id: 'turn-c2' }),
]

function parse(lines: readonly string[], state: CodexState = newCodexState()) {
  return lines.flatMap(l => codexLine(state, l))
}

const steps = (ops: CodexOp[]) => ops.flatMap(o => (o.op === 'step' ? [o.record] : []))
const events = (ops: CodexOp[]) => ops.flatMap(o => (o.op === 'event' ? [o.record] : []))

test('each response of the main thread is a step: sent after the last input line, its uncached part apart from its cached', () => {
  const s = steps(parse(ROOT_LINES))
  expect(s.map(r => [r.t0 - START, r.t1 - START, r.in, r.cr, r.cw, r.out, r.thread, r.turn, r.idx])).toEqual([
    [500, 4100, 13600, 6400, 0, 300, MAIN, 'turn-1', 0],
    [5000, 9100, 1000, 20000, 0, 200, MAIN, 'turn-1', 1],
    [90 * MIN + 1000, 90 * MIN + 5000, 15600, 6400, 0, 300, MAIN, 'turn-2', 0],
    [90 * MIN + 20100, 90 * MIN + 31000, 1000, 8000, 0, 300, MAIN, 'turn-2', 1],
  ])
  expect(s[0]).toMatchObject({ model: 'gpt-6.1-sol', effort: 'medium', ctx: 20000, tools: ['exec'], msgs: 0 })
  expect(s[0]!.gapMs).toBeUndefined()
  expect([s[1]!.gapMs, s[2]!.gapMs]).toEqual([4500, 90 * MIN + 1000 - 5000])
  expect(s[1]!.tools).toEqual(['spawn_agent'])
})

test('the request just before a compacted line is the compaction, with its usage, and no step', () => {
  const ops = parse(ROOT_LINES)
  const compactions = ops.flatMap(o => (o.op === 'compaction' ? [o] : []))
  expect(compactions).toEqual([{ op: 'compaction', model: 'gpt-6.1-sol', usage: { in: 1500, cr: 21000, cw: 0, out: 1500 }, record: { k: 'compact', t0: START + 90 * MIN + 5000, t1: START + 90 * MIN + 20000, thread: MAIN, trigger: 'unknown', before: 22500, usage: { in: 1500, cr: 21000, cw: 0, out: 1500 }, stepsSeen: 0 } }])
})

test('the meta names the thread and its session; the rate limits, the new agent and the follow-up are events', () => {
  const ops = parse(ROOT_LINES)
  expect(ops[0]).toEqual({ op: 'meta', thread: ROOT, session: ROOT, cwd: '/Users/me/CANARY_PROJECT', t: START })
  expect(events(ops)).toEqual([
    { k: 'quota', t: START + 5000, thread: MAIN, windowMin: 10080, used: 40, resetsAt: 1791603396000 },
    { k: 'agent-call', t0: START + 9000, t1: START + 9000, thread: MAIN, agent: '/root/review_auth', agentType: 'code-reviewer', model: 'gpt-6.1-sol', status: 'started', bg: true },
    { k: 'quota', t: START + 90 * MIN + 21000, thread: MAIN, windowMin: 10080, used: 43, resetsAt: 1791603396000 },
    { k: 'send', t: START + 90 * MIN + 30000, thread: MAIN, to: '/root/review_auth', risk: false, mode: 'warn' },
  ])
})

test('a subagent\'s file is its own thread: its first meta counts, a message up to its parent is no send, each task\'s end is a stop', () => {
  const ops = parse(CHILD_LINES)
  expect(ops[0]).toEqual({ op: 'meta', thread: CHILD, session: ROOT, parent: ROOT, role: 'code-reviewer', path: '/root/review_auth', cwd: '/Users/me/CANARY_PROJECT', t: START + 9500 })
  expect(events(ops).map(r => [r.k, 't' in r ? r.t - START : r.t0 - START])).toEqual([['agent-start', 9500], ['agent-stop', 18000], ['agent-stop', 90 * MIN + 45000]])
  expect(steps(ops).map(r => [r.thread, r.agentType, r.effort, r.in, r.cr])).toEqual([[CHILD, 'code-reviewer', 'low', 15000, 0], [CHILD, 'code-reviewer', 'low', 1000, 15000], [CHILD, 'code-reviewer', 'low', 10600, 6400]])
})

test('a session put together from its files: steps, compaction totals, names, and the new agent and follow-up resolved to the subagent', () => {
  const c = newCollector()
  applyCodexOps(c, parse(CHILD_LINES))
  applyCodexOps(c, parse(ROOT_LINES))
  resolveCodex(c, { coldAfterMin: 60, coldTokens: 10000 })
  expect(c.names).toEqual({ '/root/review_auth': CHILD, '/root': MAIN })
  expect(c.groups['main|compaction|gpt-6.1-sol']).toEqual({ steps: 1, in: 1500, out: 1500, cr: 21000, cw: 0 })
  expect(c.groups['main||gpt-6.1-sol']!.steps).toBe(4)
  expect(c.groups['subagent|code-reviewer|gpt-6.1-sol']!.steps).toBe(3)
  expect(c.records.find(r => r.k === 'agent-call')).toMatchObject({ agent: CHILD })
  expect(c.records.find(r => r.k === 'send')).toEqual({ k: 'send', t: START + 90 * MIN + 30000, thread: MAIN, to: CHILD, risk: true, gapMs: 90 * MIN + 30000 - 15000, ctx: 16000, mode: 'warn' })
  expect(c.agentTypes[CHILD]).toBe('code-reviewer')
})

test('nothing the user or the model wrote reaches the records: no prompt, argument, output, path, nickname or instruction', () => {
  const c = newCollector()
  applyCodexOps(c, parse(ROOT_LINES))
  applyCodexOps(c, parse(CHILD_LINES))
  resolveCodex(c, { coldAfterMin: 60, coldTokens: 10000 })
  const kept = JSON.stringify({ records: c.records, groups: c.groups, agentTypes: c.agentTypes })
  expect(kept).not.toContain('CANARY')
  expect(kept).not.toContain('/Users')
  const state = newCodexState()
  parse(ROOT_LINES, state)
  expect(JSON.stringify(state)).not.toContain('CANARY')
})

test('a file read in two parts, its state saved between them as JSON, gives what one read gives', () => {
  const whole = parse(ROOT_LINES)
  const first = newCodexState()
  const a = parse(ROOT_LINES.slice(0, 16), first)
  const b = parse(ROOT_LINES.slice(16), JSON.parse(JSON.stringify(first)) as CodexState)
  expect([...a, ...b]).toEqual(whole)
})

test('a file of Codex 0.122, with no usage records, takes each request from its token count, a repeat or a zero left out', () => {
  const count = (ms: number, input: number, cached: number, output: number) =>
    line(ms, 'event_msg', { type: 'token_count', info: { total_token_usage: { input_tokens: 0 }, last_token_usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: output, reasoning_output_tokens: 0, total_tokens: input + output } }, rate_limits: null })
  const old = [
    JSON.stringify({ timestamp: new Date(START).toISOString(), type: 'session_meta', payload: { id: ROOT, session_id: ROOT, cwd: '/x', source: 'cli' } }),
    line(10, 'turn_context', { model: 'gpt-5.4' }),
    count(4000, 12000, 0, 100),
    count(4001, 12000, 0, 100),
    count(9000, 13000, 12000, 50),
    count(9500, 0, 0, 0),
  ]
  expect(steps(parse(old)).map(r => [r.t1 - START, r.in, r.cr, r.out, r.model])).toEqual([[4000, 12000, 0, 100, 'gpt-5.4'], [9000, 1000, 12000, 50, 'gpt-5.4']])
})

test('a line that is not JSON, or of a type the meter does not read, is passed over', () => {
  const state = newCodexState()
  expect(codexLine(state, '{"timestamp":"2026-10-06T09:00:00.000Z","type":"tru')).toEqual([])
  expect(codexLine(state, 'garbage')).toEqual([])
  expect(codexLine(state, line(0, 'world_state', { full: true }))).toEqual([])
})
