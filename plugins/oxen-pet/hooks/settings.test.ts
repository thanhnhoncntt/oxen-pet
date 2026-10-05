import { expect, test } from 'claude-code/testing'

import { DEFAULTS, readSettings } from './settings'

test('no options give the defaults', () => {
  expect(readSettings({})).toEqual(DEFAULTS)
})

test('each option sets its setting', () => {
  expect(readSettings({ speed: 'fast', sleepAfter: 300, hud: false, statusLine: false, targets: false, minis: false, cacheTtl: '5m' })).toEqual({
    pace: 1.6, sleepAfterMs: 300000, hud: false, statusLine: false, targets: false, minis: false, cacheTtlMin: 5,
  })
})

test('a value from another version, or a malformed one, takes its default', () => {
  expect(readSettings({ speed: 'ludicrous', sleepAfter: -5, hud: 'yes', cacheTtl: '2h', retired: true })).toEqual(DEFAULTS)
})

test('targets stay hidden unless the user turns them on', () => {
  expect(readSettings({}).targets).toBe(false)
  expect(readSettings({ targets: true }).targets).toBe(true)
})

test('the cache timer counts an hour unless the user picks five minutes or turns it off', () => {
  expect(readSettings({}).cacheTtlMin).toBe(60)
  expect(readSettings({ cacheTtl: '5m' }).cacheTtlMin).toBe(5)
  expect(readSettings({ cacheTtl: 'off' }).cacheTtlMin).toBe(0)
  expect(readSettings({ cacheTtl: 'toString' }).cacheTtlMin).toBe(60)
})
