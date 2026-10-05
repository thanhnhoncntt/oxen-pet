import { expect, test } from 'claude-code/testing'
import type { AgentInfo } from 'claude-code'

import { minisOnScreen, reconcile } from './minis'

const agent = (id: string, status: AgentInfo['status']): AgentInfo => ({ id, description: id, type: 'general-purpose', status })

test('a mini joins for each running agent and stays while it runs', () => {
  let minis = reconcile([], [agent('a', 'running'), agent('b', 'completed')], 0)
  expect(minis.map(m => m.id)).toEqual(['a'])
  minis = reconcile(minis, [agent('a', 'running')], 60000)
  expect(minis).toEqual([{ id: 'a', since: 0 }])
})

test('a mini leaves 1.5 s after its agent ends, marked failed when the agent failed', () => {
  let minis = reconcile([], [agent('a', 'running'), agent('b', 'running')], 0)
  minis = reconcile(minis, [agent('a', 'completed'), agent('b', 'failed')], 1000)
  expect(minis).toEqual([
    { id: 'a', since: 0, doneAt: 1000, failed: false },
    { id: 'b', since: 0, doneAt: 1000, failed: true },
  ])
  expect(reconcile(minis, [], 2499).length).toBe(2)
  expect(reconcile(minis, [], 2500)).toEqual([])
})

test('an agent gone from the list counts as finished', () => {
  const minis = reconcile(reconcile([], [agent('a', 'running')], 0), [], 500)
  expect(minis).toEqual([{ id: 'a', since: 0, doneAt: 500, failed: false }])
})

test('the minis on screen carry their ages, and an ended one shows until it leaves', () => {
  const minis = [{ id: 'a', since: 0 }, { id: 'b', since: 200, doneAt: 1000, failed: true }]
  expect(minisOnScreen(minis, 2000)).toEqual([{ age: 2000, doneFor: undefined, failed: undefined }, { age: 1800, doneFor: 1000, failed: true }])
  expect(minisOnScreen(minis, 2500)).toHaveLength(1)
})
