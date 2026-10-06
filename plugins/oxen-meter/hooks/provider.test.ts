import { expect, test } from 'claude-code/testing'

import { familyOf, providerOf, weightsOf } from './provider'

test('a model\'s provider comes from its name', () => {
  expect(['claude-opus-5-5', 'claude-fable-5-1-medium', 'claude-haiku-4-5-20251001'].map(providerOf)).toEqual(['anthropic', 'anthropic', 'anthropic'])
  expect(['gpt-6.1-sol', 'gpt-5.4-mini', 'o4-mini', 'codex-mini-latest'].map(providerOf)).toEqual(['openai', 'openai', 'openai', 'openai'])
  expect(['swe-2-medium', 'SWE-2-max'].map(providerOf)).toEqual(['cognition', 'cognition'])
  expect(['compactor', ''].map(providerOf)).toEqual(['other', 'other'])
})

test('a model\'s family drops what varies within it: the effort, the size, the date', () => {
  expect(['gpt-6.1-sol', 'gpt-6-astra', 'gpt-5.4-mini', 'claude-opus-5-5', 'claude-fable-5-1-medium', 'swe-2-medium', 'compactor'].map(familyOf)).toEqual(['gpt-6.1', 'gpt-6', 'gpt-5.4', 'opus', 'fable', 'swe-2', 'compactor'])
})

test('Claude Code\'s writes weigh by its TTL; another tool\'s Claude writes weigh 1.25; a provider that writes nothing reads at the cached weight', () => {
  expect(weightsOf('claude', 'claude-opus-5-5', 60, 0.25)).toEqual({ w: 2, rw: 0.1 })
  expect(weightsOf('claude', 'claude-opus-5-5', 5, 0.25)).toEqual({ w: 1.25, rw: 0.1 })
  expect(weightsOf('devin', 'claude-fable-5-1-medium', 60, 0.25)).toEqual({ w: 1.25, rw: 0.1 })
  expect(weightsOf('codex', 'gpt-6.1-sol', 60, 0.25)).toEqual({ w: 1, rw: 0.25 })
  expect(weightsOf('devin', 'swe-2-medium', 5, 0.1)).toEqual({ w: 1, rw: 0.1 })
})
