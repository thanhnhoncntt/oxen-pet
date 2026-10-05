import { expect, test } from 'claude-code/testing'

import { PREVIEW_PREFIX, previewPathError, previewTargetError } from './previewPath'

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

const stat = (kind: 'file' | 'dir' | 'other', isLink = false, realPath?: string) => ({ kind, size: 0, mtimeMs: 0, isLink, realPath })

test('a new preview file in an existing folder may be written', () => {
  expect(previewTargetError(undefined, stat('dir'))).toBeUndefined()
})

test('an existing plain preview file may be overwritten', () => {
  expect(previewTargetError(stat('file', false, '/private/tmp/oxen-pet-preview.html'), stat('dir'))).toBeUndefined()
})

test('a symbolic link at the path is refused, wherever it leads', () => {
  expect(previewTargetError(stat('file', true, '/Users/me/.zshrc'), stat('dir'))).toContain('symbolic link')
  expect(previewTargetError(stat('other', true), stat('dir'))).toContain('symbolic link')
})

test('a path that is a folder, or lands on another name, is refused', () => {
  expect(previewTargetError(stat('dir', false, '/tmp/oxen-pet-preview.html'), stat('dir'))).toContain('not a plain file')
  expect(previewTargetError(stat('file', false, '/Users/me/.zshrc'), stat('dir'))).toContain('lands on')
  expect(previewTargetError(stat('file'), stat('dir'))).toContain('lands on')
})

test('a missing folder is refused rather than created', () => {
  expect(previewTargetError(undefined, undefined)).toContain('folder')
  expect(previewTargetError(undefined, stat('file'))).toContain('folder')
})
