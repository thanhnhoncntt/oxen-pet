export type Mode =
  | 'idle'
  | 'sleep'
  | 'think'
  | 'read'
  | 'search'
  | 'edit'
  | 'bash'
  | 'web'
  | 'agent'
  | 'run'
  | 'jump'
  | 'cheer'
  | 'error'
  | 'guard'

export type Anim = {
  mode: Mode
  since: number
  x: number
  dir: 1 | -1
  tick: number
  target: string
  working: boolean // whether a turn was running at the last tick
  leap?: Leap // a running pet's leap over an obstacle, until it lands
}

/** A leap from column `from` to column `to`, begun at `since`. The pet plays its jump clip, slowed, on the way. */
export type Leap = { since: number; from: number; to: number }

declare module 'claude-code' {
  interface PluginState {
    'oxen-pet': { anim: Anim }
  }
}
