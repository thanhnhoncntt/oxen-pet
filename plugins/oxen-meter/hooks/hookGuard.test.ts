import { expect, test } from 'claude-code/testing'

import { followUpWarning, idleRisk, promptAnswer } from './hookGuard'

const MIN = 60000
const O = { coldAfterMin: 60, coldTokens: 50000, cachedWeight: 0.1 }
const last = { t0: 0, ctx: 180000, model: 'gpt-6.1-sol' }

test('a thread is at risk once it sat the Cold after minutes with at least the cold tokens, priced as its context sent again', () => {
  expect(idleRisk(last, 72 * MIN, O)).toEqual({ idleMs: 72 * MIN, ctx: 180000, extra: 162000 })
  expect(idleRisk(last, 59 * MIN, O)).toBeUndefined()
  expect(idleRisk({ ...last, ctx: 40000 }, 72 * MIN, O)).toBeUndefined()
  expect(idleRisk(undefined, 72 * MIN, O)).toBeUndefined()
  expect(idleRisk({ ...last, model: 'claude-fable-5-1-medium' }, 72 * MIN, O)!.extra).toBe(207000)
})

const risk = { idleMs: 72 * MIN, ctx: 180000, extra: 162000 }

test('warn shows the user a message; ask holds the prompt back once, and the user sends it anyway with up and enter; off says nothing', () => {
  expect(promptAnswer(risk, 'warn', false)).toEqual({ systemMessage: 'oxen-meter: this thread sat 1h12m. Its 180K context is likely out of the cache, so this prompt sends it all again (~162K eq). A fresh thread with a short summary costs less.' })
  expect(promptAnswer(risk, 'ask', false)).toEqual({ decision: 'block', reason: 'oxen-meter: this thread sat 1h12m. Its 180K context is likely out of the cache, so this prompt sends it all again (~162K eq). Press ↑ and Enter to send it anyway, or start a fresh thread with a short summary.' })
  expect(promptAnswer(risk, 'ask', true)).toBeUndefined()
  expect(promptAnswer(risk, 'off', false)).toBeUndefined()
  expect(promptAnswer(undefined, 'ask', false)).toBeUndefined()
})

test('a follow-up to a subagent that sat past it warns the user, whatever the mode but off: a tool call cannot be asked about', () => {
  expect(followUpWarning(risk, 'warn', 'worker 3f2a')).toEqual({ systemMessage: 'oxen-meter: worker 3f2a sat 1h12m. Resuming it likely sends its 180K context again (~162K eq); a fresh subagent with a short handoff costs less.' })
  expect(followUpWarning(risk, 'ask', 'worker 3f2a')).toEqual(followUpWarning(risk, 'warn', 'worker 3f2a'))
  expect(followUpWarning(risk, 'off', 'worker 3f2a')).toBeUndefined()
  expect(followUpWarning(undefined, 'warn', 'worker 3f2a')).toBeUndefined()
})
