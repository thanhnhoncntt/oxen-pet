import { expect, test } from 'claude-code/testing'

import { DEFAULTS, readSettings } from './settings'

test('no options give the defaults', () => {
  expect(readSettings({})).toEqual(DEFAULTS)
  expect(DEFAULTS).toEqual({ resumeGuard: 'warn', coldTokens: 50000, mainTtl: 'auto', subagentTtl: 'auto', userLabel: '', hashProject: true, outputWeight: 5, retentionDays: 30, dataDir: '' })
})

test('each option sets its setting', () => {
  expect(readSettings({ resumeGuard: 'ask', coldTokens: 8000, mainTtl: '5m', subagentTtl: '1h', userLabel: ' nhon ', hashProject: false, outputWeight: 4, retentionDays: 7, dataDir: '/srv/meter' })).toEqual({
    resumeGuard: 'ask', coldTokens: 8000, mainTtl: '5m', subagentTtl: '1h', userLabel: 'nhon', hashProject: false, outputWeight: 4, retentionDays: 7, dataDir: '/srv/meter',
  })
})

test('a value from another version, or a malformed one, takes its default', () => {
  expect(readSettings({ resumeGuard: 'block', coldTokens: -1, mainTtl: '2h', subagentTtl: 'toString', userLabel: 42, hashProject: 'no', outputWeight: Number.NaN, retentionDays: 0, dataDir: null, retired: true })).toEqual(DEFAULTS)
  expect(readSettings({ coldTokens: '50000', outputWeight: Infinity, retentionDays: 10.6 })).toEqual({ ...DEFAULTS, retentionDays: 11 })
})

test('a label longer than a short name is cut', () => {
  expect(readSettings({ userLabel: 'x'.repeat(100) }).userLabel).toBe('x'.repeat(40))
})
