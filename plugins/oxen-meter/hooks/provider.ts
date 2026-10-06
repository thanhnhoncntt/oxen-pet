import type { Tool } from './record'

/**
 * Who serves a model, by its name, and what its tokens weigh. Anthropic charges for a cache write (1.25 for a 5-minute
 * cache, 2 for an hour) and 0.1 for a read. OpenAI and Cognition report no cache writes: an input token is read from
 * the cache or sent in full, and a cached one weighs what the user's Cached input weight setting says, since that
 * price differs from model to model.
 */

export type Provider = 'anthropic' | 'openai' | 'cognition' | 'other'

const ANTHROPIC_READ = 0.1
/** What another tool's Claude writes weigh: Claude Code alone reports which TTL it asked for. */
const OTHER_TOOL_WRITE = 1.25

export function providerOf(model: string): Provider {
  if (/claude|opus|sonnet|haiku|fable/i.test(model)) {
    return 'anthropic'
  }
  if (/^(gpt|o\d|codex|chatgpt)/i.test(model)) {
    return 'openai'
  }

  return /^swe-/i.test(model) ? 'cognition' : 'other'
}

/** A model's family: `gpt-6.1` for `gpt-6.1-sol`, `opus` for `claude-opus-5-5`, `swe-2` for `swe-2-medium`. */
export function familyOf(model: string) {
  const name = model.match(/opus|sonnet|haiku|fable/i)?.[0] ?? model.match(/^gpt-\d+(?:\.\d+)?/i)?.[0] ?? model.match(/^swe-\d+/i)?.[0]

  return (name ?? model).toLowerCase()
}

/**
 * What one written token (`w`) and one read token (`rw`) weigh against an uncached one, for a step of `tool` on
 * `model`: Claude Code's writes by its role's TTL (`ttlMin`), another tool's Claude writes at 1.25, and for a provider
 * that writes nothing, reads at `cachedWeight` (a write it might report weighs as an uncached token).
 */
export function weightsOf(tool: Tool, model: string, ttlMin: number, cachedWeight: number) {
  if (providerOf(model) !== 'anthropic') {
    return { w: 1, rw: cachedWeight }
  }

  return { w: tool === 'claude' ? (ttlMin >= 60 ? 2 : 1.25) : OTHER_TOOL_WRITE, rw: ANTHROPIC_READ }
}
