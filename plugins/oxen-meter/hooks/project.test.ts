import { expect, test } from 'claude-code/testing'

import { projectLabel } from './project'

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
