import { HEIGHT, canvas, stamp } from './pixels'
import type { Canvas } from './pixels'

/**
 * The boss: a failed test run brings a bug into the band, every failed run after hits harder, and the next run
 * that passes defeats it. A run piped into another command (`npm test | tail`) ends with that command's exit
 * code, so it reads as passed.
 */
export type Boss = { since: number; hits: number; defeatedAt?: number }
export type TestOutcome = 'passed' | 'failed'

export const BOSS_W = 16
export const DEFEAT_MS = 1600
const FLASH_MS = 600 // the first part of the defeat, the boss flashing white before it puffs away
const MAX_PIPS = 5

const TEST_RUNS = [
  /\b(npm|pnpm|yarn|bun)\s+(run\s+)?test\b/,
  /\bnpx\s+(jest|vitest|mocha|playwright\s+test)\b/,
  /(^|[;&|(]\s*)(jest|vitest|mocha|pytest|rspec|phpunit)\b/,
  /\bpython3?\s+-m\s+pytest\b/,
  /\b(go|cargo|deno|dotnet|make)\s+test\b/,
  /\b(mvnw?|gradlew?)\s+test\b/,
  /\bclaude\s+plugin\s+test\b/,
]

/** Whether `command` runs a test suite with one of the common tools. */
export const isTestCommand = (command: string) => TEST_RUNS.some(re => re.test(command))

/** A test run's outcome from its tool.call result; undefined when it was refused, interrupted, or sent to the background. */
export function testOutcome(result: { deny?: string; isError?: true; result?: unknown; text?: string }): TestOutcome | undefined {
  if (result.deny !== undefined) {
    return undefined
  }
  if (result.isError) {
    return 'failed'
  }
  const out = (result.result ?? {}) as { interrupted?: boolean; backgroundTaskId?: string }

  return out.interrupted || out.backgroundTaskId !== undefined ? undefined : 'passed'
}

/** The boss after a test run with `outcome` at `t`. */
export function bossAfter(boss: Boss | undefined, outcome: TestOutcome | undefined, t: number): Boss | undefined {
  if (outcome === 'failed') {
    return boss && boss.defeatedAt === undefined ? { ...boss, hits: boss.hits + 1 } : { since: t, hits: 1 }
  }
  if (outcome === 'passed' && boss && boss.defeatedAt === undefined) {
    return { ...boss, defeatedAt: t }
  }

  return boss
}

/** The boss while it is on screen: until its defeat has played out. */
export const bossOnScreen = (boss: Boss | undefined, t: number) => (boss && (boss.defeatedAt === undefined || t - boss.defeatedAt < DEFEAT_MS) ? boss : undefined)

// An original bug: antennae, a purple shell, red eyes and a toothy grin, on four legs.
const BUG = [
  '...A........A...',
  '....A......A....',
  '.....DDDDDD.....',
  '...DDPPPPPPDD...',
  '..DPPPPPPPPPPD..',
  '..DPWWPPPPWWPD..',
  '.DPPWRPPPPRWPPD.',
  '.DPPPPPPPPPPPPD.',
  '.DPPKKKKKKKKPPD.',
  '.DPPKWKWKWKWPPD.',
  '..DPPPPPPPPPPD..',
  '..GDDPPPPPPDDG..',
]
const LEGS = [
  ['.G..G.DDDD.G..G.', 'G...G......G...G'],
  ['..G.G.DDDD.G.G..', '..G..G....G..G..'],
]
const PALETTE = { A: 0xa78bfa, D: 0x4c1d95, P: 0x7c3aed, W: 0xffffff, R: 0xf43f5e, K: 0x1e1033, G: 0x8b5cf6 }
const WHITE = Object.fromEntries(Object.keys(PALETTE).map(ch => [ch, 0xffffff]))
const PIP = 0xf43f5e
const SMOKE = 0x9ca3af
const STAR = 0xffe25a

function drawBug(c: Canvas, t: number, palette: Record<string, number>) {
  const step = Math.floor(t / 400) % 2
  const rows = [...BUG, ...(LEGS[step] as string[])]
  stamp(c, 0, HEIGHT - rows.length - step, rows, palette)
}

/** The boss at `t`, BOSS_W by HEIGHT: bobbing, with a pip per hit above it, or flashing and puffing away once defeated. */
export function drawBoss(boss: Boss, t: number): Canvas {
  const c = canvas(BOSS_W, HEIGHT)
  if (boss.defeatedAt === undefined) {
    drawBug(c, t, PALETTE)
    for (let k = 0; k < Math.min(boss.hits, MAX_PIPS); k++) {
      c.px[2 * BOSS_W + 2 + k * 3] = PIP
      c.px[2 * BOSS_W + 3 + k * 3] = PIP
    }
    return c
  }
  const u = t - boss.defeatedAt
  if (u < FLASH_MS) {
    drawBug(c, t, Math.floor(u / 100) % 2 ? WHITE : PALETTE)
    return c
  }
  // A ring of smoke and four stars spreading from where the bug stood.
  const k = (u - FLASH_MS) / (DEFEAT_MS - FLASH_MS)
  const dot = (x: number, y: number, color: number) => {
    const [px, py] = [Math.round(x), Math.round(y)]
    if (px >= 0 && px < BOSS_W && py >= 0 && py < HEIGHT) {
      c.px[py * BOSS_W + px] = color
    }
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * 2 * Math.PI
    dot(8 + Math.cos(a) * (2 + 5 * k), 13 + Math.sin(a) * (2 + 4 * k), SMOKE)
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * 2 * Math.PI + Math.PI / 4
    dot(8 + Math.cos(a) * (1 + 6 * k), 13 + Math.sin(a) * (1 + 5 * k), STAR)
  }

  return c
}

/** What the boss drawing says to a reader that cannot see it. */
export const bossAlt = (boss: Boss) => (boss.defeatedAt === undefined ? `a bug boss, ${boss.hits} hit${boss.hits === 1 ? '' : 's'}` : 'a bug boss, defeated')
