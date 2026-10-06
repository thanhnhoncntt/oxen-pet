/**
 * Names the records keep short and unguessable: a session's id in an export, and the project a session ran in, by
 * default a hash of its folder's name with a salt of the user's own; the name itself when the user turns hashing off.
 */

const HEX_LENGTH = 12

const baseName = (path: string) => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? ''

/** The first 12 hex digits of SHA-256 over `salt` and `text`. */
export async function shortHash(salt: string, text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${text}`))

  return [...new Uint8Array(digest)]
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, HEX_LENGTH)
}

export async function projectLabel(root: string, salt: string, hash: boolean): Promise<string> {
  const name = baseName(root)

  return hash ? shortHash(salt, name) : name
}
