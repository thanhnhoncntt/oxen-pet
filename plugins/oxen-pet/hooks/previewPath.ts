/** The name every preview file starts with. preview_theme writes nowhere else, so a misled call cannot overwrite a dotfile or source code. */
export const PREVIEW_PREFIX = 'oxen-pet-preview'

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
  const name = parts[parts.length - 1]
  if (!name.startsWith(PREVIEW_PREFIX) || !name.endsWith('.html')) {
    return `\`path\` must name a file that starts with ${PREVIEW_PREFIX} and ends with .html, such as /tmp/${PREVIEW_PREFIX}-cat.html.`
  }

  return undefined
}
