import { expect, test } from 'claude-code/testing'

import { BUILT_IN, DEFAULT_THEME, customDirOf, isThemeName, themeFile, themeList, themeNames } from './custom'

test('the custom folder sits beside the plugins, under the same .claude folder, where an update never writes', () => {
  expect(customDirOf('/Users/me/.claude/plugins/cache/oxen-pet/oxen-pet/1.1.0', '')).toBe('/Users/me/.claude/oxen-pet/themes')
  expect(customDirOf('C:\\Users\\me\\.claude\\plugins\\cache\\oxen-pet\\oxen-pet\\1.1.0', '')).toBe('C:\\Users\\me\\.claude/oxen-pet/themes')
  // Loaded from a working copy, the plugin has no .claude folder above it.
  expect(customDirOf('/Users/me/src/oxen-pet/plugins/oxen-pet', '')).toBeUndefined()
})

test('the Custom folder setting moves it, to an absolute path with no ..', () => {
  expect(customDirOf('/Users/me/.claude/plugins/cache/x', '/Users/me/dotfiles/pets/')).toBe('/Users/me/dotfiles/pets')
  expect(customDirOf('/Users/me/.claude/plugins/cache/x', '  /srv/pets  ')).toBe('/srv/pets')
  for (const bad of ['pets', '~/pets', '/srv/../etc', '$HOME/pets']) {
    expect(customDirOf('/Users/me/.claude/plugins/cache/x', bad)).toBe('/Users/me/.claude/oxen-pet/themes')
  }
})

test('a theme name is letters, digits, - and _, so it names one file in the folder and nothing outside it', () => {
  for (const name of ['luffy', 'Gear-5', 'my_cat2']) {
    expect(isThemeName(name)).toBe(true)
  }
  for (const name of ['', '../x', 'a/b', 'a.b', 'x'.repeat(41), 'luffy ']) {
    expect(isThemeName(name)).toBe(false)
  }
  expect(themeFile('/d', 'luffy')).toBe('/d/luffy.theme.json')
})

test('the folder lists the theme files by name, leaving out other files, folders, and bad names', () => {
  const entries = [
    { name: 'zoro.theme.json', kind: 'file' },
    { name: 'luffy.theme.json', kind: 'file' },
    { name: 'notes.txt', kind: 'file' },
    { name: 'old.theme.json', kind: 'dir' },
    { name: 'bad name.theme.json', kind: 'file' },
  ]
  expect(themeNames(entries)).toEqual(['luffy', 'zoro'])
})

test('the list shows the built-in pets and the user\'s own, marks the one on screen, and says where the folder is', () => {
  expect(DEFAULT_THEME).toBe('luffy')
  expect(BUILT_IN).toContain('slime')
  const text = themeList(['zoro'], 'zoro', '/Users/me/.claude/oxen-pet/themes')
  expect(text).toContain('Built in: luffy, slime, duck, alien')
  expect(text).toContain('Yours: zoro ◀ on screen')
  expect(text).toContain('/Users/me/.claude/oxen-pet/themes')
  expect(text).toContain('/pet theme <name>')
  expect(themeList([], 'luffy', undefined)).toContain('luffy ◀ on screen')
  expect(themeList([], 'luffy', undefined)).toContain('Set Custom folder')
})
