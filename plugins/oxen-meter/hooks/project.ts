/**
 * The project a session ran in, as the records name it: by default a hash of its folder's name with a salt of the
 * user's own, so a name cannot be guessed back from it; the name itself when the user turns hashing off.
 */

const HEX_LENGTH = 12

const baseName = (path: string) => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? ''

export async function projectLabel(root: string, salt: string, hash: boolean): Promise<string> {
  const name = baseName(root)
  if (!hash) {
    return name
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${name}`))

  return [...new Uint8Array(digest)]
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, HEX_LENGTH)
}
