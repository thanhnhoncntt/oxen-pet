import type { Mode } from '../types'

export type ToolMode = 'read' | 'search' | 'edit' | 'bash' | 'web' | 'agent'

const TOOL_MODE: Record<string, ToolMode> = {
  Read: 'read',
  Grep: 'search',
  Glob: 'search',
  Edit: 'edit',
  MultiEdit: 'edit',
  Write: 'edit',
  NotebookEdit: 'edit',
  TodoWrite: 'edit',
  Bash: 'bash',
  WebFetch: 'web',
  WebSearch: 'web',
  Task: 'agent',
  Agent: 'agent',
}

const MAX_TARGET = 24

export function toolMode(tool: string): ToolMode {
  return TOOL_MODE[tool] ?? 'bash'
}

const clip = (s: string) => (s.length > MAX_TARGET ? `${s.slice(0, MAX_TARGET - 1)}…` : s)
const text = (v: unknown) => (typeof v === 'string' ? v : '')

/** What the tool works on, as the status line names it: a file, a pattern, a command, a host. */
export function targetOf(tool: string, input: Record<string, unknown>) {
  switch (tool in TOOL_MODE ? tool : 'other') {
    case 'Read':
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
      return clip(text(input.file_path).split('/').pop() ?? '')
    case 'NotebookEdit':
      return clip(text(input.notebook_path).split('/').pop() ?? '')
    case 'TodoWrite':
      return 'the todo list'
    case 'Grep':
    case 'Glob':
      return clip(text(input.pattern))
    case 'Bash':
      return clip(text(input.command).split('\n')[0] ?? '')
    case 'WebFetch':
      return clip(text(input.url).replace(/^https?:\/\//, '').split('/')[0] ?? '')
    case 'WebSearch':
      return clip(text(input.query))
    case 'other':
      return clip(tool.split('__').pop() ?? tool)
    default:
      return ''
  }
}

/** The mod's status lines by mode; `{}` stands for the target. A pet's own `lines` replace a mode's. */
export const LINES: Record<Mode, string[]> = {
  idle: ['hmm, what shall we build?', 'counting pixels…', '*stretches*', 'tidying up', 'ready when you are'],
  sleep: ['zzz… wake me with a prompt', 'zzz… dreaming in pixels', 'zzz…'],
  think: ['pondering', 'chewing on the problem', 'asking around', 'compiling excuses…', 'almost got it…'],
  read: ['reading {}', 'turning pages of {}', 'skimming {}…', 'turning pages…'],
  search: ['hunting for "{}"', 'sniffing out "{}"', 'looking under every file'],
  edit: ['editing {}', 'writing the change', 'shaping {}'],
  bash: ['$ {}', 'typing: {}', 'crossing fingers…'],
  web: ['fetching {}', 'surfing to {}', 'waiting for the net…'],
  agent: ['sending out the minis', 'the little ones are on it'],
  run: ['zoom, zoom', 'on it!', 'hop hop hop'],
  jump: ['here we go!', 'on it!'],
  cheer: ['ta-da!', 'all done!', 'nailed it ✦'],
  error: ['oops, that one bit back', 'that did not work', 'ouch…'],
  guard: ['shield up! that one deletes things', 'hold on, asking you first', 'is this really okay?'],
}

const SWAP_MS = 4000

/** The columns a terminal gives `text`: two for an emoji, none for a joiner or variation selector. */
export const lineWidth = (text: string) =>
  [...text].reduce((n, ch) => n + (/[\u200d\ufe0e\ufe0f]/.test(ch) ? 0 : /\p{Extended_Pictographic}/u.test(ch) ? 2 : 1), 0)

// Mid-tone colors, so the line reads on a dark terminal and on a light one.
const LINE_COLOR: Record<Mode, string> = {
  idle: '#3b9dff',
  sleep: '#8b8ff0',
  think: '#a77bf3',
  read: '#e8a33d',
  search: '#e8a33d',
  edit: '#e0b400',
  bash: '#2fbf5b',
  web: '#14b3c9',
  agent: '#3b9dff',
  run: '#3b9dff',
  jump: '#3b9dff',
  cheer: '#e0b400',
  error: '#f0506e',
  guard: '#e0763a',
}

/** The color of the status line and its arrow in this mode: the pet's own, else the mod's. */
export const lineColor = (mode: Mode, own: Partial<Record<Mode, string>> = {}) => own[mode] ?? LINE_COLOR[mode]

/**
 * A line for the mode, from the pet's `own` lines when it has them; the pick moves on every 4 s and starts
 * differently per `since`. With no target, only lines that need none.
 */
export function statusLine(mode: Mode, since: number, elapsedMs: number, target: string, own?: string[]) {
  const all = own ?? LINES[mode]
  const untargeted = all.filter(l => !l.includes('{}'))
  const lines = target || untargeted.length === 0 ? all : untargeted
  const seed = Math.abs(Math.floor(since / 100)) % lines.length
  const line = lines[(seed + Math.floor(Math.max(0, elapsedMs) / SWAP_MS)) % lines.length] as string

  return line.replace('{}', target || 'something')
}
