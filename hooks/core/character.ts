// What each character shows at a time: its state from the agent status, and
// the frame of each motion. Pure: the time comes in as an argument.
import type { AgentRow } from './agents'
import { isEnded } from './agents'
import { motionOf } from './pack/motions'
import { partOf } from './pack/pack'
import type { CharacterState, Motion, Pack, PartFrame, PartSelection, Pose } from './pack/pack'

/** How long a new character is `entering` before it is `working`. */
export const ENTER_MS = 1500

/** `full` animates; `reduced` shows one still pose for each state; `off` shows the still character. */
export type MotionMode = 'full' | 'reduced' | 'off'

const MOTION_MODES: readonly unknown[] = ['full', 'reduced', 'off'] satisfies MotionMode[]

/** The `motion` option. The engine gives only the manifest's values, so another value is a bug; it falls back to `full`. */
export function motionMode(option: unknown): MotionMode {
  return MOTION_MODES.includes(option) ? (option as MotionMode) : 'full'
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

/** The frame of a motion `elapsedMs` after it started. A loop wraps; a one-shot motion holds its last frame. */
export function frameAt(motion: Motion<unknown>, elapsedMs: number, mode: MotionMode = 'full'): FrameAt {
  const last = motion.frames.length - 1
  // Reduced motion keeps the pose that tells the state: the end of a one-shot motion, the start of a loop.
  if (mode === 'reduced') return { index: motion.loop ? 0 : last, nextAt: null }
  const step = Math.floor((Math.max(0, elapsedMs) * motion.fps) / 1000)
  const index = motion.loop ? step % motion.frames.length : Math.min(step, last)
  const changes = motion.loop ? last > 0 : step < last
  // The first whole millisecond at which the step is one more.
  return { index, nextAt: changes ? Math.ceil(((step + 1) * 1000) / motion.fps) : null }
}

/**
 * What a character shows at `now`. `key` names the pose, so equal keys draw
 * equal pixels; `nextAt` is the time of its next frame change, or `null` when
 * no later time changes the pose.
 */
export type CharacterPose = { key: string; pose: Pose; nextAt: number | null }

export function characterPose(pack: Pack, selection: PartSelection, row: AgentRow, now: number, mode: MotionMode): CharacterPose {
  if (mode === 'off') return { key: 'still', pose: {}, nextAt: null }
  const { state, since } = characterState(row, now)
  const changes: number[] = []
  const keys: string[] = []
  const pose: { body?: Pose['body']; parts?: Record<string, PartFrame> } = {}

  const body = motionOf(pack, state)
  if (body !== null) {
    const { index, nextAt } = frameAt(body, now - since, mode)
    pose.body = body.frames[index]
    keys.push(`${state}:${index}`)
    if (nextAt !== null) changes.push(since + nextAt)
  }
  // A part motion is the part's own: it runs from the spawn, whatever the state.
  for (const [slot, name] of Object.entries(selection)) {
    const motion = partOf(pack, slot, name)?.motion
    if (motion === undefined) continue
    const { index, nextAt } = frameAt(motion, now - row.startedAt, mode)
    pose.parts = { ...pose.parts, [slot]: motion.frames[index]! }
    keys.push(`${slot}:${index}`)
    if (nextAt !== null) changes.push(row.startedAt + nextAt)
  }
  // The entrance ends at a fixed time. Only a different working motion changes the pose then.
  if (state === 'entering' && body !== motionOf(pack, 'working')) changes.push(row.startedAt + ENTER_MS)
  return { key: keys.join('|') || 'still', pose, nextAt: changes.length > 0 ? Math.min(...changes) : null }
}
