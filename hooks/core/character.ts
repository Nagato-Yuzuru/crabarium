// What each character shows at a time: its state from the agent status, and
// the frame of each motion. Pure: the time comes in as an argument.
import type { AgentRow } from './agents.ts'
import { isEnded } from './agents.ts'
import { coversAny, partOf } from './pack/pack.ts'
import type { CharacterState, Frame, Motion, Pack, PartFrame, PartSelection, Pose, Role } from './pack/pack.ts'
import type { Rule } from './pack/rules.ts'
import { motionNamed, styleOf } from './pack/style.ts'
import type { Style } from './pack/style.ts'

/** How long a new character is `entering` before it is `working`. */
export const ENTER_MS = 1500

/** `full` animates; `reduced` shows one still pose for each state; `off` shows the still character. */
export type MotionMode = 'full' | 'reduced' | 'off'

const MOTION_MODES: readonly unknown[] = ['full', 'reduced', 'off'] satisfies MotionMode[]

function isMotionMode(option: unknown): option is MotionMode {
  return MOTION_MODES.includes(option)
}

/** The `motion` option. The engine gives only the manifest's values, so another value is a bug; it falls back to `full`. */
export function motionMode(option: unknown): MotionMode {
  return isMotionMode(option) ? option : 'full'
}

const STATE_OF_STATUS = {
  pending: 'working',
  running: 'working',
  waiting: 'idle',
  idle: 'idle',
  completed: 'finished',
  failed: 'failed',
  killed: 'failed',
} as const satisfies Record<AgentRow['status'], CharacterState>

/**
 * The state, and the time its motion starts from. A live agent's motion runs
 * from the spawn, so it does not jump when `entering` turns into `working`. An
 * ended agent's runs from the end, which a later correction of how it ended
 * (failed to killed) does not move. Nothing gives `leaving` yet: rows do not
 * leave the pane.
 */
export function characterState(row: AgentRow, now: number): { state: CharacterState; since: number } {
  if (!isEnded(row.status) && now - row.startedAt < ENTER_MS) return { state: 'entering', since: row.startedAt }
  const state = STATE_OF_STATUS[row.status]
  if (state === 'working') return { state, since: row.startedAt }
  if (row.endedAt !== null) return { state, since: row.endedAt }
  // `$.state` outlives a hot reload, so a row from a build before `statusAt` has none.
  return { state, since: Number.isFinite(row.statusAt) ? row.statusAt : row.startedAt }
}

/** A frame index, and the elapsed time of the next frame change; `null` when no later time changes it. */
export type FrameAt = { index: number; nextAt: number | null }

/**
 * The frame of a motion `elapsedMs` after it started. A frame holds for its
 * `repeat` ticks. A loop wraps; a one-shot motion holds its last frame.
 */
export function frameAt(motion: Motion<{ repeat?: number }>, elapsedMs: number, mode: MotionMode = 'full'): FrameAt {
  const last = motion.frames.length - 1
  // Reduced motion keeps the pose that tells the state: the end of a one-shot motion, the start of a loop.
  if (mode === 'reduced') return { index: motion.loop ? 0 : last, nextAt: null }
  // The tick at which each frame ends.
  const ends: number[] = []
  for (const frame of motion.frames) ends.push((ends.at(-1) ?? 0) + (frame.repeat ?? 1))
  const total = ends.at(-1) ?? 1
  const step = Math.floor((Math.max(0, elapsedMs) * motion.fps) / 1000)
  if (!motion.loop && step >= total - (motion.frames[last]?.repeat ?? 1)) return { index: last, nextAt: null }
  const cycle = motion.loop ? Math.floor(step / total) * total : 0
  const index = ends.findIndex(end => step - cycle < end)
  // The first whole millisecond of the tick at which the next frame starts; a loop of one frame never changes.
  const nextTick = cycle + ends[index]!
  return { index, nextAt: motion.loop && last === 0 ? null : Math.ceil((nextTick * 1000) / motion.fps) }
}

/** What decides how an agent looks: its pack, the pack's rules, the agent's role, and the parts that it wears. */
export type Look = { pack: Pack; rules: readonly Rule[]; role: Role | null; parts: PartSelection }

/**
 * What a character shows at `now`. `key` names the pose, so equal keys draw
 * equal pixels for one look; `nextAt` is the time of its next frame change,
 * or `null` when no later time changes the pose.
 */
export type CharacterPose = { key: string; pose: Pose; nextAt: number | null }

/**
 * The frame on the base pose: the frame's swaps win, except on a locked
 * channel, or where a covering drawing would hide a locked node.
 */
export function onPose(pack: Pack, style: Style, frame: Frame | undefined): Frame {
  const swap: Record<string, string> = { ...style.pose }
  for (const [channel, value] of Object.entries(frame?.swap ?? {})) {
    if (style.locks.has(channel) || coversAny(pack, channel, value, style.locks)) continue
    swap[channel] = value
  }
  return { ...frame, swap }
}

// Whether two styles draw the same track 0: the same loop on the same base pose.
function sameLoop(a: Style, b: Style): boolean {
  const keys = Object.keys(a.pose)
  return (
    a.play === b.play &&
    keys.length === Object.keys(b.pose).length &&
    keys.every(k => a.pose[k] === b.pose[k]) &&
    a.locks.size === b.locks.size &&
    [...a.locks].every(l => b.locks.has(l))
  )
}

export function characterPose(look: Look, row: AgentRow, now: number, mode: MotionMode): CharacterPose {
  const { pack, rules, role, parts } = look
  const { state, since } = characterState(row, now)
  const style = styleOf(pack, rules, { role, state, parts })
  // The role and the state choose the style; the rest of the look is the caller's key.
  const keys = [`${role ?? '-'}:${state}`]
  if (mode === 'off') return { key: keys[0]!, pose: { body: onPose(pack, style, undefined) }, nextAt: null }
  const changes: number[] = []
  const pose: { body?: Pose['body']; parts?: Record<string, PartFrame> } = {}

  const body = style.play === null ? null : motionNamed(pack, style.play)
  let frame: Frame | undefined
  if (body !== null) {
    const { index, nextAt } = frameAt(body, now - since, mode)
    frame = body.frames[index]
    keys.push(String(index))
    if (nextAt !== null) changes.push(since + nextAt)
  }
  pose.body = onPose(pack, style, frame)
  // A part motion is the part's own: it runs from the spawn, whatever the state.
  for (const [slot, name] of Object.entries(parts)) {
    const motion = partOf(pack, slot, name)?.motion
    if (motion === undefined) continue
    const { index, nextAt } = frameAt(motion, now - row.startedAt, mode)
    pose.parts = { ...pose.parts, [slot]: motion.frames[index]! }
    keys.push(`${slot}:${index}`)
    if (nextAt !== null) changes.push(row.startedAt + nextAt)
  }
  // The entrance ends at a fixed time. Only a different working style changes the pose then.
  if (state === 'entering' && !sameLoop(style, styleOf(pack, rules, { role, state: 'working', parts }))) {
    changes.push(row.startedAt + ENTER_MS)
  }
  return { key: keys.join('|'), pose, nextAt: changes.length > 0 ? Math.min(...changes) : null }
}
