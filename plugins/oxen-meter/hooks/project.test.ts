import { expect, test } from 'claude-code/testing'

import { projectLabel, shortHash } from './project'

test('a hashed project is 12 hex digits, the same for the same folder and salt, and never the name', async () => {
  const a = await projectLabel('/Users/me/src/oxen-pet', 'salt-1', true)
  expect(a).toMatch(/^[0-9a-f]{12}$/)
  expect(await projectLabel('/Users/me/other/oxen-pet/', 'salt-1', true)).toBe(a)
  expect(await projectLabel('/Users/me/src/oxen-pet', 'salt-2', true)).not.toBe(a)
  expect(await projectLabel('/Users/me/src/gn-crypto', 'salt-1', true)).not.toBe(a)
})

test('unhashed, the project is its folder\'s name', async () => {
  expect(await projectLabel('/Users/me/src/oxen-pet', 'salt-1', false)).toBe('oxen-pet')
  expect(await projectLabel('C:\\src\\app\\', 'salt-1', false)).toBe('app')
})

test('a short hash is 12 hex digits of the salted text, so the same session keeps one id across a user\'s exports', async () => {
  const id = await shortHash('salt-1', '2f6c1d0a-8e1b-4c55-9a39-0c0f6f9e6b11')
  expect(id).toMatch(/^[0-9a-f]{12}$/)
  expect(await shortHash('salt-1', '2f6c1d0a-8e1b-4c55-9a39-0c0f6f9e6b11')).toBe(id)
  expect(await shortHash('salt-2', '2f6c1d0a-8e1b-4c55-9a39-0c0f6f9e6b11')).not.toBe(id)
  expect(await projectLabel('/src/oxen-pet', 'salt-1', true)).toBe(await shortHash('salt-1', 'oxen-pet'))
})
