import type { FsStat } from 'claude-code'

/** The name every preview file starts with. preview_theme writes nowhere else, so a misled call cannot overwrite a dotfile or source code. */
export const PREVIEW_PREFIX = 'oxen-pet-preview'

const baseName = (p: string) => p.split(/[\\/]/).pop() ?? ''
const isPreviewName = (name: string) => name.startsWith(PREVIEW_PREFIX) && name.endsWith('.html')

const isAbsolute = (p: string) => p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p)

/** Why preview_theme must not write to `path`, or undefined when it may: an absolute path with no `..`, to a file named oxen-pet-preview….html. */
export function previewPathError(path: unknown): string | undefined {
  if (typeof path !== 'string' || path === '') {
    return '`path` is the HTML file to write.'
  }
  if (!isAbsolute(path)) {
    return '`path` must be absolute.'
  }
  const parts = path.split(/[\\/]/)
  if (parts.includes('..')) {
    return '`path` must not contain `..`.'
  }
  if (!isPreviewName(parts[parts.length - 1] ?? '')) {
    return `\`path\` must name a file that starts with ${PREVIEW_PREFIX} and ends with .html, such as /tmp/${PREVIEW_PREFIX}-cat.html.`
  }

  return undefined
}

/**
 * Why preview_theme must not write where an allowed `path` leads, or undefined when it may. `own` is the path's stat
 * with `realPath`, undefined when nothing is there yet; `folder` is its folder's. The spelling check alone lets a
 * symbolic link planted at an allowed name send the write to any file, and lets the write create missing folders.
 */
export function previewTargetError(own: FsStat | undefined, folder: FsStat | undefined): string | undefined {
  if (own === undefined) {
    return folder?.kind === 'dir' ? undefined : 'its folder must already exist.'
  }
  if (own.isLink) {
    return '`path` is a symbolic link.'
  }
  if (own.kind !== 'file') {
    return '`path` is not a plain file.'
  }
  if (own.realPath === undefined || !isPreviewName(baseName(own.realPath))) {
    return `\`path\` lands on ${own.realPath ?? 'a place that cannot be resolved'}, not an ${PREVIEW_PREFIX} file.`
  }

  return undefined
}
