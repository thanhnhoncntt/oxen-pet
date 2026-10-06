import { expect, test } from 'claude-code/testing'

import { DEFAULTS, readSettings } from './settings'

test('no options give the defaults', () => {
  expect(readSettings({})).toEqual(DEFAULTS)
})

test('each option sets its setting', () => {
  expect(readSettings({ speed: 'fast', sleepAfter: 300, hud: false, statusLine: false, targets: false, minis: false, cacheTtl: '5m', guard: false, boss: false, hudLayout: 'row', theme: 'zoro', customDir: '/srv/pets' })).toEqual({
    pace: 1.6, sleepAfterMs: 300000, hud: false, statusLine: false, targets: false, minis: false, cacheTtlMin: 5, guard: false, boss: false, hudRow: true, theme: 'zoro', customDir: '/srv/pets',
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

test('the shield and the boss are on unless the user turns them off', () => {
  expect([readSettings({}).guard, readSettings({}).boss]).toEqual([true, true])
  expect(readSettings({ guard: 'no', boss: 0 })).toEqual(DEFAULTS)
})

test('the HUD stacks its bars unless the user lays them in a row', () => {
  expect(readSettings({}).hudRow).toBe(false)
  expect(readSettings({ hudLayout: 'row' }).hudRow).toBe(true)
  expect(readSettings({ hudLayout: 'sideways' }).hudRow).toBe(false)
})

test('the pet a session starts with is Luffy unless the user names another, and a name that is not one stays Luffy', () => {
  expect(readSettings({}).theme).toBe('luffy')
  expect(readSettings({ theme: ' zoro ' }).theme).toBe('zoro')
  expect(readSettings({ theme: '../../etc/passwd' }).theme).toBe('luffy')
  expect(readSettings({}).customDir).toBe('')
})
