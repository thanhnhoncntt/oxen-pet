import { expect, test } from 'claude-code/testing'

import { lineColor, statusLine, targetOf, toolMode } from './status'

test('each tool maps to its own action', () => {
  expect(['Read', 'Grep', 'Edit', 'Bash', 'WebFetch', 'Task', 'mcp__x__y'].map(toolMode)).toEqual(['read', 'search', 'edit', 'bash', 'web', 'agent', 'bash'])
})

test('the target names what the tool works on', () => {
  expect(targetOf('Read', { file_path: '/a/b/app.ts' })).toBe('app.ts')
  expect(targetOf('Grep', { pattern: 'useState' })).toBe('useState')
  expect(targetOf('Bash', { command: 'npm test\nnpm run build' })).toBe('npm test')
  expect(targetOf('WebFetch', { url: 'https://docs.anthropic.com/en/docs' })).toBe('docs.anthropic.com')
  expect(targetOf('mcp__srv__lookup', {})).toBe('lookup')
  expect(targetOf('Bash', { command: 'x'.repeat(60) })).toHaveLength(24)
})

test('the line fills in the target and moves on every four seconds', () => {
  expect(statusLine('read', 0, 0, 'app.ts')).toBe('reading app.ts')
  expect(statusLine('read', 0, 4000, 'app.ts')).toBe('turning pages of app.ts')
  expect(statusLine('read', 0, 16000, 'app.ts')).toBe('reading app.ts')
  expect(statusLine('bash', 0, 0, '')).toBe('crossing fingers…')
  expect(statusLine('read', 0, 0, '')).toBe('turning pages…')
})

test('every mode has its own line color', () => {
  expect(lineColor('bash')).toBe('#2fbf5b')
  expect(lineColor('error')).toBe('#f0506e')
})

test("a pet's own lines and colors replace the mod's for their modes", () => {
  expect(statusLine('read', 0, 0, 'app.ts', ['scanning {} with my eye stalks'])).toBe('scanning app.ts with my eye stalks')
  expect(statusLine('read', 0, 0, '', ['beaming up {}', 'humming'])).toBe('humming')
  expect(lineColor('bash', { bash: '#00ff88' })).toBe('#00ff88')
  expect(lineColor('read', { bash: '#00ff88' })).toBe('#e8a33d')
})
