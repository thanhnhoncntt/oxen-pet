import { expect, test } from 'claude-code/testing'

import { CLI_KINDS, dataPathError, dataRootOf, dataTargetError, exportPath, saltPath, sessionPath, statePath } from './dataPath'

const ROOT = '/Users/me/.claude/oxen-meter'
const SID = '2f6c1d0a-8e1b-4c55-9a39-0c0f6f9e6b11'

test('the data folder is the setting\'s absolute path, else oxen-meter in the .claude folder the plugin is installed under', () => {
  expect(dataRootOf('/Users/me/.claude/plugins/cache/oxen-pet/oxen-meter/0.1.0', '')).toBe(ROOT)
  expect(dataRootOf('/Users/me/.claude/plugins/cache/oxen-pet/oxen-meter/0.1.0', ' /srv/meter/ ')).toBe('/srv/meter')
  expect(dataRootOf('C:\\Users\\me\\.claude\\plugins\\oxen-meter', '')).toBe('C:\\Users\\me\\.claude/oxen-meter')
})

test('no data folder when the setting is not a plain absolute path and the plugin is not under a .claude folder', () => {
  expect(dataRootOf('/Users/me/src/oxen-pet/plugins/oxen-meter', '')).toBeUndefined()
  for (const bad of ['relative/dir', '/srv/../etc', '~/meter', '/srv/$HOME']) {
    expect(dataRootOf('/Users/me/src/oxen-pet/plugins/oxen-meter', bad)).toBeUndefined()
  }
})

test('a session file and an export file are named from strict parts', () => {
  expect(sessionPath(ROOT, SID)).toBe(`${ROOT}/sessions/${SID}.json`)
  expect(exportPath(ROOT, '20261006', '')).toBe(`${ROOT}/exports/oxen-meter-export-20261006.json`)
  expect(exportPath(ROOT, '20261006', 'Nhon N.')).toBe(`${ROOT}/exports/oxen-meter-export-20261006-nhon-n.json`)
})

test('the two allowed targets pass the spelling check', () => {
  expect(dataPathError(ROOT, `${ROOT}/sessions/${SID}.json`)).toBeUndefined()
  expect(dataPathError(ROOT, `${ROOT}/exports/oxen-meter-export-20261006-nhon.json`)).toBeUndefined()
})

test('any other path is refused by its spelling', () => {
  for (const p of [
    `${ROOT}/sessions/../../settings.json`,
    `${ROOT}/sessions/x.json`,
    `${ROOT}/sessions/${SID}.json.sh`,
    `${ROOT}/sessions/sub/${SID}.json`,
    `${ROOT}/exports/report.json`,
    `${ROOT}/${SID}.json`,
    `/tmp/sessions/${SID}.json`,
    'sessions/x.json',
    42,
  ]) {
    expect(dataPathError(ROOT, p)).toBeDefined()
  }
  expect(dataPathError('relative', `relative/sessions/${SID}.json`)).toBeDefined()
})

const dir = (realPath: string, isLink = false) => ({ kind: 'dir' as const, size: 0, mtimeMs: 0, isLink, realPath })
const file = (realPath: string, isLink = false) => ({ kind: 'file' as const, size: 0, mtimeMs: 0, isLink, realPath })
const REAL = '/Users/me/dotfiles/claude/oxen-meter' // ~/.claude itself may be a link into a dotfiles repo
const TARGET = `${ROOT}/sessions/${SID}.json`

test('a first write may create the data folder when its parent is a folder', () => {
  expect(dataTargetError(TARGET, { parent: dir('/Users/me/dotfiles/claude') })).toBeUndefined()
  expect(dataTargetError(TARGET, {})).toContain('parent')
  expect(dataTargetError(TARGET, { parent: file('/Users/me/.claude') })).toContain('parent')
})

test('an existing data folder, kind folder and file, all plain, may be written', () => {
  expect(dataTargetError(TARGET, { root: dir(REAL), dir: dir(`${REAL}/sessions`) })).toBeUndefined()
  expect(dataTargetError(TARGET, { root: dir(REAL), dir: dir(`${REAL}/sessions`), file: file(`${REAL}/sessions/${SID}.json`) })).toBeUndefined()
  expect(dataTargetError(TARGET, { root: dir(REAL) })).toBeUndefined()
})

test('a symbolic link at the data folder, the kind folder or the file is refused', () => {
  expect(dataTargetError(TARGET, { root: dir('/etc', true) })).toContain('symbolic link')
  expect(dataTargetError(TARGET, { root: dir(REAL), dir: dir('/etc', true) })).toContain('symbolic link')
  expect(dataTargetError(TARGET, { root: dir(REAL), dir: dir(`${REAL}/sessions`), file: file('/Users/me/.zshrc', true) })).toContain('symbolic link')
})

test('a path that lands anywhere but where it is spelled, or on something that is not a file, is refused', () => {
  expect(dataTargetError(TARGET, { root: file(REAL) })).toContain('not a folder')
  expect(dataTargetError(TARGET, { root: dir(REAL), dir: dir('/Users/me/elsewhere') })).toContain('lands on')
  expect(dataTargetError(TARGET, { root: dir(REAL), dir: dir(`${REAL}/sessions`), file: file('/Users/me/.zshrc') })).toContain('lands on')
  expect(dataTargetError(TARGET, { root: dir(REAL), dir: dir(`${REAL}/sessions`), file: dir(`${REAL}/sessions/${SID}.json`) })).toContain('not a plain file')
  expect(dataTargetError(TARGET, { root: dir(REAL), dir: dir(`${REAL}/sessions`), file: { ...file(''), realPath: undefined } })).toContain('lands on')
})

test('Windows separators compare as one', () => {
  const win = 'C:\\Users\\me\\.claude/oxen-meter'
  expect(dataTargetError(`${win}/sessions/${SID}.json`, { root: dir('C:\\Users\\me\\.claude\\oxen-meter'), dir: dir('C:\\Users\\me\\.claude\\oxen-meter\\sessions') })).toBeUndefined()
})

test('the salt the mod and the CLI share is a file the mod may write; the CLI\'s import state and locks are the CLI\'s alone', () => {
  expect(saltPath(ROOT)).toBe(`${ROOT}/state/salt.json`)
  expect(statePath(ROOT, 'codex', 'json')).toBe(`${ROOT}/state/codex.json`)
  expect(statePath(ROOT, 'devin', 'guard.json')).toBe(`${ROOT}/state/devin.guard.json`)
  expect(dataPathError(ROOT, saltPath(ROOT))).toBeUndefined()
  for (const name of ['codex.json', 'devin.json', 'codex.lock', 'devin.lock', 'codex.guard.json', 'devin.guard.json']) {
    expect(dataPathError(ROOT, `${ROOT}/state/${name}`)).toBeDefined()
    expect(dataPathError(ROOT, `${ROOT}/state/${name}`, CLI_KINDS)).toBeUndefined()
  }
  for (const name of ['other.json', 'codex.json.bak', '../salt.json', 'salt.lock', 'codex.guard.lock']) {
    expect(dataPathError(ROOT, `${ROOT}/state/${name}`, CLI_KINDS)).toBeDefined()
  }
  expect(dataPathError(ROOT, `${ROOT}/sessions/codex-01a10f34-8859-7e71-b716-87d71c201fe1.json`, CLI_KINDS)).toBeUndefined()
  expect(dataTargetError(saltPath(ROOT), { root: dir(REAL), dir: dir(`${REAL}/state`) })).toBeUndefined()
  expect(dataTargetError(saltPath(ROOT), { root: dir(REAL), dir: dir('/tmp/state') })).toContain('lands on')
})
