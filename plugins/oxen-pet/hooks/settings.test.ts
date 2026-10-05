import { expect, test } from 'claude-code/testing'

import { DEFAULTS, readSettings } from './settings'

test('no options give the defaults', () => {
  expect(readSettings({})).toEqual(DEFAULTS)
})

test('each option sets its setting', () => {
  expect(readSettings({ speed: 'fast', sleepAfter: 300, hud: false, statusLine: false, targets: false, minis: false })).toEqual({
    pace: 1.6, sleepAfterMs: 300000, hud: false, statusLine: false, targets: false, minis: false,
  })
})

test('a value from another version, or a malformed one, takes its default', () => {
  expect(readSettings({ speed: 'ludicrous', sleepAfter: -5, hud: 'yes', retired: true })).toEqual(DEFAULTS)
})

test('targets stay hidden unless the user turns them on', () => {
  expect(readSettings({}).targets).toBe(false)
  expect(readSettings({ targets: true }).targets).toBe(true)
})
