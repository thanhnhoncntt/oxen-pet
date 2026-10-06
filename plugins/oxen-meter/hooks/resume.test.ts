import { expect, test } from 'claude-code/testing'

import { MAIN, newCollector } from './record'
import { RESUME_OPTIONS, coldStartText, freshReason, resolveRecipient, resumeQuestion, resumeRisk } from './resume'

const MIN = 60000
const thread = (lastT0: number, lastCtx: number) => ({ lastT0, lastT1: lastT0 + 1000, lastCtx, lastModel: 'claude-opus-5-5', lastMsgs: 9, steps: 3 })

test('a thread is at risk from nine tenths of its TTL, with a context of at least the cold tokens', () => {
  expect(resumeRisk(thread(0, 400000), 4 * MIN, 5, 50000)).toBeUndefined()
  expect(resumeRisk(thread(0, 400000), 4.5 * MIN, 5, 50000)).toEqual({ gapMs: 4.5 * MIN, ctx: 400000, ttlMin: 5, extra: 460000 })
  expect(resumeRisk(thread(0, 400000), 62 * MIN, 60, 50000)).toEqual({ gapMs: 62 * MIN, ctx: 400000, ttlMin: 60, extra: 760000 })
  expect(resumeRisk(thread(0, 40000), 62 * MIN, 5, 50000)).toBeUndefined()
  expect(resumeRisk(undefined, 62 * MIN, 5, 50000)).toBeUndefined()
})

test('a message\'s recipient is found by agent id, by the name an Agent call gave it, or by a name one live agent has', () => {
  const c = newCollector()
  c.threads['agent-7f3a'] = thread(0, 1)
  c.names.scout = 'agent-1111'
  const live = [{ id: 'agent-2222', name: 'fixer' }, { id: 'agent-3333', name: 'twin' }, { id: 'agent-4444', name: 'twin' }]
  expect(resolveRecipient('agent-7f3a', c, live)).toBe('agent-7f3a')
  expect(resolveRecipient('scout', c, live)).toBe('agent-1111')
  expect(resolveRecipient('fixer', c, live)).toBe('agent-2222')
  expect(resolveRecipient('agent-3333', c, live)).toBe('agent-3333')
  expect(resolveRecipient('main', c, live)).toBe(MAIN)
  expect(resolveRecipient('twin', c, live)).toBeUndefined()
  expect(resolveRecipient('someone@other-session', c, live)).toBeUndefined()
})

test('the question and the toast say how long the agent sat, how much it holds, and what resuming costs', () => {
  const risk = { gapMs: 62 * MIN, ctx: 400000, ttlMin: 5, extra: 460000 }
  expect(resumeQuestion(risk, 'Explore 7f3a')).toBe(
    'oxen-meter: Explore 7f3a has sat 1h02m, past its 5m cache. Resuming it writes its 400K context again: about 460K token equivalents. Spawn a fresh agent with a short handoff instead?',
  )
  expect(coldStartText(risk, 'Explore 7f3a')).toBe('oxen-meter: Explore 7f3a woke after 1h02m with a cold cache: writing 400K context again (~460K eq).')
  expect(Object.values(RESUME_OPTIONS)).toEqual(['Spawn a fresh agent', 'Resume anyway'])
})

test('a refused resume tells Claude what to do instead, without the message', () => {
  const reason = freshReason({ gapMs: 62 * MIN, ctx: 400000, ttlMin: 5, extra: 460000 }, 'Explore 7f3a')
  expect(reason).toContain('The user chose not to resume Explore 7f3a')
  expect(reason).toContain('Spawn a fresh agent')
  expect(reason).toContain('handoff')
})
