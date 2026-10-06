import { expect, test } from 'claude-code/testing'

import { newStats, noteMp, recordShield, recordTest, recordTool, recordTurn, statsRows } from './stats'

const at = (rows: { label: string; value: string }[], label: string) => rows.find(r => r.label === label)?.value

test('a fresh session shows its length and nothing else it has not done', () => {
  const rows = statsRows(newStats(0), 5 * 60000, undefined, false)
  expect(at(rows, 'Session')).toBe('5m · 0 turns')
  expect(rows.map(r => r.label)).toEqual(['Session'])
})

test('tool calls count by what the pet acted out, failures apart, and files by read and edited', () => {
  let s = newStats(0)
  s = recordTool(s, 'Read', { file_path: '/p/app.ts' }, false)
  s = recordTool(s, 'Read', { file_path: '/p/app.ts' }, false)
  s = recordTool(s, 'Read', { file_path: '/p/hud.ts' }, false)
  s = recordTool(s, 'Edit', { file_path: '/p/app.ts' }, false)
  s = recordTool(s, 'Grep', { pattern: 'x' }, false)
  s = recordTool(s, 'Bash', { command: 'npm test' }, true)
  s = recordTool(s, 'Agent', { prompt: 'go' }, false)
  s = recordTurn(recordTurn(s))
  const rows = statsRows(s, 72 * 60000, undefined, false)
  expect(at(rows, 'Session')).toBe('1h12m · 2 turns')
  expect(at(rows, 'Tools')).toBe('7 calls: 3 read · 1 search · 1 edit · 1 bash · 1 agent · 1 failed')
  expect(at(rows, 'Files')).toBe('2 read · 1 edited')
  expect(at(rows, 'Subagents')).toBe('1')
})

test('file names show only with Name files and commands on', () => {
  let s = newStats(0)
  s = recordTool(s, 'Write', { file_path: '/p/a.ts' }, false)
  s = recordTool(s, 'Edit', { file_path: '/p/b.ts' }, false)
  expect(at(statsRows(s, 0, undefined, false), 'Files')).toBe('2 edited')
  expect(at(statsRows(s, 0, undefined, true), 'Files')).toBe('2 edited: a.ts, b.ts')
})

test('test runs, beaten bosses, and the shield add their rows', () => {
  let s = newStats(0)
  s = recordTest(s, 'failed', false)
  s = recordTest(s, 'failed', false)
  s = recordTest(s, 'passed', true)
  s = recordShield(recordShield(s, 'blocked'), 'ran')
  const rows = statsRows(s, 0, undefined, false)
  expect(at(rows, 'Tests')).toBe('3 runs: 1 passed · 2 failed · 1 boss beaten')
  expect(at(rows, 'Shield')).toBe('2 asked: 1 blocked · 1 ran')
})

test('the burn rate is MP used per hour since the first reading, once enough time has passed', () => {
  let s = newStats(0)
  s = noteMp(s, 90, 0)
  s = noteMp(s, 80, 5 * 60000)
  expect(at(statsRows(s, 5 * 60000, { hp: 70, mp: 80 }, false), 'Burn')).toBe('context 30% used')
  expect(at(statsRows(s, 30 * 60000, { hp: 70, mp: 78 }, false), 'Burn')).toBe('MP 24%/h · context 30% used')
})
