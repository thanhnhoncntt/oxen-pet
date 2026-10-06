import type { Anim, Leap, Mode } from '../types'
import { BODY_W, MODES } from './pixels'
import type { Span } from './scene'
import { DEFAULTS } from './settings'
import type { Settings } from './settings'
import type { ToolMode } from './status'

export const TICK_MS = 100
const SPEED = 9 // cells per second at normal pace
const RUN_AFTER_TOOL_MS = 4000
const JUMP_YIELDS_MS = 400 // a tool call cuts the start-of-turn hop short after this long
const JUMP_MS = MODES.jump.once as number
/** A leap plays the jump clip this much slower, so the pet clears its own width while in the air. */
const LEAP_SLOW = 4 / 3
export const LEAP_MS = JUMP_MS * LEAP_SLOW
// The part of the jump clip in which a leaping pet travels: from the frame it has lifted 5 px of 9 to the one it
// has come down to 6. The pet crouches before it and drops straight down after it.
const AIR = [3 / 14, 9 / 14] as const
const LEAP_GAP = 2 // the most columns between the body canvas and an obstacle when the pet takes off

/** What the session is doing, as the hooks last saw it. */
export type Activity = {
  isWorking: boolean
  activeTools: number
  activeMode: ToolMode // the latest tool call's mode
  activeTarget: string
  lastToolAt: number
  room: number // the furthest column a running pet may reach
  obstacles: Span[] // the scene's obstacles, in band columns
  trail: number // the minis' width, drawn behind the pet
  guarding?: boolean // a risky command waits for the user's answer, or just got it
}

/** The mode the pet holds while nothing starts or ends. */
function settle(w: Activity, t: number): Mode {
  if (!w.isWorking) {
    return 'idle'
  }
  if (w.activeTools > 0) {
    return w.activeMode
  }

  return t - w.lastToolAt < RUN_AFTER_TOOL_MS ? 'run' : 'think'
}

/**
 * The pet one tick later, at time `t`. A turn starting makes it jump and a turn ending makes it cheer. A mode
 * with a fixed length (jump, cheer, error) runs out before the pet settles, sooner at a faster pace. Idle turns
 * to sleep after `sleepAfterMs`. A running pet moves and turns at `room`; at an obstacle it leaps, or turns when
 * the landing is past the edge. A leap plays out before anything else changes. An `a` saved by another version
 * of the mod, with a mode this one lacks, starts over idle.
 */
export function step(a: Anim, w: Activity, t: number, s: Pick<Settings, 'pace' | 'sleepAfterMs'> = DEFAULTS): Anim {
  if (a.leap) {
    const u = (t - a.leap.since) * s.pace
    // Nothing else starts mid-air: `working` holds, so a turn that ended or began still cheers or jumps on landing.
    if (u < LEAP_MS) {
      return { ...a, x: leapX(a.leap, u), tick: a.tick + 1 }
    }
    const { leap: _, ...landed } = a
    a = { ...landed, x: a.leap.to }
  }
  let { mode, since, x, dir } = a
  let leap: Leap | undefined
  if (!(mode in MODES)) {
    mode = 'idle'
    since = t
  }
  const length = MODES[mode].once
  const once = length === undefined ? undefined : length / s.pace

  if (w.guarding) {
    // The shield goes up at once, whatever the pet was doing, and stays up until the user answers.
    if (mode !== 'guard') {
      mode = 'guard'
      since = t
    }
  } else if (a.working && !w.isWorking) {
    mode = 'cheer'
    since = t
  } else if (!a.working && w.isWorking) {
    mode = 'jump'
    since = t
  } else if (once !== undefined) {
    const yields = mode === 'jump' && w.activeTools > 0 && t - since >= JUMP_YIELDS_MS / s.pace
    if (t - since >= once || yields) {
      mode = settle(w, t)
      since = t
    }
  } else {
    let want = settle(w, t)
    const canSleep = s.sleepAfterMs > 0
    if (want === 'idle' && canSleep && (mode === 'sleep' || (mode === 'idle' && t - since >= s.sleepAfterMs))) {
      want = 'sleep'
    }
    if (want !== mode) {
      mode = want
      since = t
    }
  }

  const ahead = mode === 'run' ? obstacleAhead(x, dir, w) : undefined
  if (ahead) {
    const to = landing(ahead, dir, w)
    if (to >= 0 && to <= w.room) {
      leap = { since: t, from: x, to }
    } else {
      dir = dir === 1 ? -1 : 1
    }
  } else if (mode === 'run') {
    x += (dir * SPEED * s.pace * TICK_MS) / 1000
    if (x >= w.room) {
      x = w.room
      dir = -1
    } else if (x <= 0) {
      x = 0
      dir = 1
    }
  }

  return { mode, since, x, dir, tick: a.tick + 1, working: w.isWorking, target: w.activeTools > 0 ? w.activeTarget : a.target, ...(leap && { leap }) }
}

// The body canvas holds every pose, the crouch and the landing dust included, so a leap measured on it clears the
// obstacle at every frame.
/** The first column of the body canvas, for a picture at column `x`: the trail is on its left unless it faces left. */
const bodyAt = (x: number, dir: 1 | -1, w: Activity) => x + (dir === 1 ? w.trail : 0)

/** The obstacle just ahead of a running pet, close enough to leap now. */
function obstacleAhead(x: number, dir: 1 | -1, w: Activity) {
  const left = bodyAt(x, dir, w)
  const right = left + BODY_W
  return w.obstacles.find(o => {
    const gap = dir === 1 ? o.x - right : left - (o.x + o.w)
    return gap >= 0 && gap <= LEAP_GAP
  })
}

/** Where a leap over `o` lands: the picture's column with the body canvas one column past the obstacle. */
function landing(o: Span, dir: 1 | -1, w: Activity) {
  const body = dir === 1 ? o.x + o.w + 1 : o.x - 1 - BODY_W
  return body - bodyAt(0, dir, w)
}

/** The picture's column `u` ms (at pace) into `leap`. */
export function leapX(leap: Leap, u: number) {
  const p = Math.min(1, Math.max(0, (u / LEAP_MS - AIR[0]) / (AIR[1] - AIR[0])))
  return leap.from + (leap.to - leap.from) * p
}

/** How far into the jump clip a leap `u` ms (at pace) in has come, at the clip's own speed. */
export const leapClipMs = (u: number) => u / LEAP_SLOW

/** The pet after a failed tool call: an error face, unless it is cheering. */
export function fail(a: Anim, t: number): Anim {
  return a.mode === 'cheer' ? a : { ...a, mode: 'error', since: t }
}
