import { expect, test } from 'claude-code/testing'

import { PREVIEW_PREFIX, previewPathError } from './previewPath'

test('a preview file in any folder is allowed', () => {
  expect(previewPathError('/tmp/oxen-pet-preview.html')).toBeUndefined()
  expect(previewPathError('/var/folders/x/T/oxen-pet-preview-cat.html')).toBeUndefined()
  expect(previewPathError('C:\\Temp\\oxen-pet-preview-cat.html')).toBeUndefined()
})

test('a missing or non-string path is refused', () => {
  for (const p of [undefined, '', 42, {}]) {
    expect(previewPathError(p)).toContain('`path` is the HTML file to write')
  }
})

test('a relative path or one with .. is refused', () => {
  expect(previewPathError('oxen-pet-preview.html')).toContain('absolute')
  expect(previewPathError('/tmp/a/../../Users/me/oxen-pet-preview.html')).toContain('..')
})

test('any other file name is refused', () => {
  for (const p of ['/Users/me/.zshrc', '/tmp/cat.html', '/tmp/oxen-pet-preview.html.sh', '/tmp/oxen-pet-preview', '/tmp/oxen-pet-preview/x.html']) {
    expect(previewPathError(p)).toContain(PREVIEW_PREFIX)
  }
})
