// What each character shows at a time: its state from the agent status, and
// the frame of each motion. Pure: the time comes in as an argument.
import type { AgentRow } from './agents.ts'
import { isEnded } from './agents.ts'
import { own } from './own.ts'
import { coversAny, isUnder, partOf } from './pack/pack.ts'
import type { CharacterState, Frame, Motion, Move, Pack, PartFrame, PartSelection, Pose, Role } from './pack/pack.ts'
import type { Rule, Weighted } from './pack/rules.ts'
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

// The tick at which each frame ends, made once for each motion: a frame count has no limit.
const endsOf = new WeakMap<Motion<{ repeat?: number }>, readonly number[]>()

function frameEnds(motion: Motion<{ repeat?: number }>): readonly number[] {
  let ends = endsOf.get(motion)
  if (ends === undefined) {
    const list: number[] = []
    for (const frame of motion.frames) list.push((list.at(-1) ?? 0) + (frame.repeat ?? 1))
    ends = list
    endsOf.set(motion, ends)
  }
  return ends
}

// The index of the first value above `tick`, by binary search over sorted values.
function firstAbove(values: readonly number[], tick: number): number {
  let [low, high] = [0, values.length - 1]
  while (low < high) {
    const mid = (low + high) >> 1
    if (values[mid]! > tick) high = mid
    else low = mid + 1
  }
  return low
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
  const ends = frameEnds(motion)
  const total = ends.at(-1) ?? 1
  const step = Math.floor((Math.max(0, elapsedMs) * motion.fps) / 1000)
  if (!motion.loop && step >= total - (motion.frames[last]?.repeat ?? 1)) return { index: last, nextAt: null }
  const cycle = motion.loop ? Math.floor(step / total) * total : 0
  const index = firstAbove(ends, step - cycle)
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

// What the locks of a style keep a frame from: a swap of a locked channel, a
// covering variant over a locked node, and a hide of a locked node or of a node
// that a locked node is on.
function lockGuard(pack: Pack, style: Style, parts: PartSelection) {
  const locks = [...style.locks]
  return {
    swap: (channel: string, value: string) => !style.locks.has(channel) && !coversAny(pack, channel, value, style.locks, parts),
    hide: (target: string) => !locks.some(locked => locked === target || isUnder(pack, locked, target, parts)),
  }
}

/** The frame on the base pose: the frame's swaps and hides apply, except where a lock keeps them from it. */
export function onPose(pack: Pack, style: Style, frame: Frame | undefined, parts: PartSelection): Frame {
  const guard = lockGuard(pack, style, parts)
  const swap: Record<string, string> = { ...style.pose }
  for (const [channel, value] of Object.entries(frame?.swap ?? {})) if (guard.swap(channel, value)) swap[channel] = value
  const hide = frame?.hide?.filter(guard.hide)
  return { ...frame, swap, ...(hide === undefined ? {} : { hide }) }
}

const sameRecord = (a: Readonly<Record<string, unknown>>, b: Readonly<Record<string, unknown>>) =>
  Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([k, v]) => Object.hasOwn(b, k) && b[k] === v)

// Whether two styles draw the same in a mode: the same loop on the same base pose, and in full motion the same tricks.
function sameStyle(a: Style, b: Style, mode: MotionMode): boolean {
  const same = a.play === b.play && sameRecord(a.pose, b.pose) && a.locks.size === b.locks.size && [...a.locks].every(l => b.locks.has(l))
  if (!same || mode !== 'full') return same
  return sameRecord(a.tricks, b.tricks) && a.trickEvery?.[0] === b.trickEvery?.[0] && a.trickEvery?.[1] === b.trickEvery?.[1]
}

/** The distinct swaps and hides of a motion: what a lock can keep it from. */
type Touches = { swaps: readonly (readonly [channel: string, value: string])[]; hides: readonly string[] }

// Made once for each motion, so the cost of a lock check does not grow with the frame count.
const touchesOf = new WeakMap<Motion, Touches>()

function touches(motion: Motion): Touches {
  let found = touchesOf.get(motion)
  if (found === undefined) {
    const swaps = new Map<string, readonly [string, string]>()
    const hides = new Set<string>()
    for (const frame of motion.frames) {
      for (const [channel, value] of Object.entries(frame.swap ?? {})) swaps.set(`${channel}\0${value}`, [channel, value])
      for (const target of frame.hide ?? []) hides.add(target)
    }
    found = { swaps: [...swaps.values()], hides: [...hides] }
    touchesOf.set(motion, found)
  }
  return found
}

// FNV-1a, then the murmur3 finalizer, so each bit of the result depends on each input character.
function hash(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193)
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return (h ^ (h >>> 16)) >>> 0
}

export type Choice = { name: string; motion: Motion; weight: number }

/** The motions of a weighted list that can play on the style: each exists, and no lock keeps it from a frame. */
export function usable(pack: Pack, style: Style, weights: Weighted, parts: PartSelection): Choice[] {
  const guard = lockGuard(pack, style, parts)
  return Object.entries(weights).flatMap(([name, weight]) => {
    const motion = motionNamed(pack, name)
    if (motion === null) return []
    const { swaps, hides } = touches(motion)
    return swaps.every(([channel, value]) => guard.swap(channel, value)) && hides.every(guard.hide) ? [{ name, motion, weight }] : []
  })
}

// A choice by weight; the same seed gives the same choice.
function pick(pool: readonly Choice[], seed: string): Choice | null {
  const total = pool.reduce((sum, choice) => sum + choice.weight, 0)
  if (total === 0) return null
  let rest = hash(seed) % total
  for (const choice of pool) {
    if (rest < choice.weight) return choice
    rest -= choice.weight
  }
  return null
}

/** How long a motion plays once through, in whole milliseconds. */
function lengthMs(motion: Motion<{ repeat?: number }>): number {
  return Math.ceil(((frameEnds(motion).at(-1) ?? 1) * 1000) / motion.fps)
}

/** A track 1 motion: a `once` motion of an event, or a trick. */
type Shot = { name: string; motion: Motion; startsAt: number }

/**
 * The track 1 motion at `now`, or `null`, and the times at which track 1 can
 * change. `begun` is when the state began. An event that the state starts
 * (`finished`, `failed`) plays its `once` motion from then. After it, trick k
 * starts at `base + min + phase + floor(k * mid) + jitter(k)`: `mid` is the
 * middle of the two `trick-every` times, the jitter is from 0 to half their
 * difference, and the phase (from 0 to `mid`) is the agent's own. So two
 * tricks are from `min` to `max` apart, the first is from `min` to
 * `min + max` after the base, two agents do not trick in step, and the trick
 * at a time is known with no history.
 */
function trackOne(
  look: Look,
  row: AgentRow,
  style: Style,
  state: CharacterState,
  begun: number,
  now: number,
): { shot: Shot | null; changes: number[] } {
  const { pack, parts } = look
  let base = begun
  const event = state === 'finished' || state === 'failed' ? style.once[state] : undefined
  if (event !== undefined) {
    const chosen = pick(usable(pack, style, event, parts), `${row.id}:${state}`)
    if (chosen !== null) {
      base = begun + lengthMs(chosen.motion)
      if (now < base) return { shot: { name: chosen.name, motion: chosen.motion, startsAt: begun }, changes: [base] }
    }
  }
  if (style.trickEvery === null) return { shot: null, changes: [] }
  const pool = usable(pack, style, style.tricks, parts)
  if (pool.length === 0) return { shot: null, changes: [] }
  const [min, max] = style.trickEvery
  const mid = (min + max) / 2
  const first = base + min + (hash(`${row.id}:${base}`) % Math.floor(mid))
  const jitter = Math.floor((max - min) / 2) + 1
  const startOf = (k: number) => first + Math.floor(k * mid) + (hash(`${row.id}:${base}:${k}`) % jitter)
  // An estimate, then one step: a jitter is less than one `mid`.
  let k = Math.max(-1, Math.floor((now - first) / mid))
  if (startOf(k + 1) <= now) k += 1
  else if (k >= 0 && startOf(k) > now) k -= 1
  const changes = [startOf(k + 1)]
  if (k < 0) return { shot: null, changes }
  const startsAt = startOf(k)
  const chosen = pick(pool, `${row.id}:${base}:${k}:trick`)
  if (chosen === null || now >= startsAt + lengthMs(chosen.motion)) return { shot: null, changes }
  changes.push(startsAt + lengthMs(chosen.motion))
  return { shot: { name: chosen.name, motion: chosen.motion, startsAt }, changes }
}

// Track 1 over track 0, per channel: its swaps and palette win, offsets add, and hides join.
function layered(below: Frame | undefined, above: Frame | undefined): Frame | undefined {
  if (below === undefined || above === undefined) return above ?? below
  const offset: Record<string, Move> = { ...below.offset }
  for (const [node, [dx, dy]] of Object.entries(above.offset ?? {})) {
    const [x, y] = own(offset, node) ?? [0, 0]
    offset[node] = [x + dx, y + dy]
  }
  const hide = [...new Set([...(below.hide ?? []), ...(above.hide ?? [])])]
  return {
    offset,
    swap: { ...below.swap, ...above.swap },
    hide,
    palette: { ...below.palette, ...above.palette },
  }
}

export function characterPose(look: Look, row: AgentRow, now: number, mode: MotionMode): CharacterPose {
  const { pack, rules, role, parts } = look
  const { state, since } = characterState(row, now)
  const style = styleOf(pack, rules, { role, state, parts })
  // The role and the state choose the style; the rest of the look is the caller's key.
  const keys = [`${role ?? '-'}:${state}`]
  const changes: number[] = []
  // The entrance ends at a fixed time. Only a different next style changes the pose then.
  if (state === 'entering') {
    const end = row.startedAt + ENTER_MS
    const next = styleOf(pack, rules, { role, state: characterState(row, end).state, parts })
    if (!sameStyle(style, next, mode)) changes.push(end)
  }
  if (mode === 'off') return { key: keys[0]!, pose: { body: onPose(pack, style, undefined, parts) }, nextAt: changes[0] ?? null }
  const pose: { body?: Pose['body']; parts?: Record<string, PartFrame> } = {}

  const body = style.play === null ? null : motionNamed(pack, style.play)
  let frame: Frame | undefined
  if (body !== null) {
    const { index, nextAt } = frameAt(body, now - since, mode)
    frame = body.frames[index]
    keys.push(String(index))
    if (nextAt !== null) changes.push(since + nextAt)
  }
  // Track 1 plays only in full motion: a trick does not tell the state.
  if (mode === 'full') {
    // Track 0 of working runs from the spawn, but working begins after the entrance, or when the agent runs again.
    const statusAt = Number.isFinite(row.statusAt) ? row.statusAt : row.startedAt
    const begun = state === 'working' ? Math.max(row.startedAt + ENTER_MS, statusAt) : since
    const one = trackOne(look, row, style, state, begun, now)
    changes.push(...one.changes)
    if (one.shot !== null) {
      const { index, nextAt } = frameAt(one.shot.motion, now - one.shot.startsAt)
      frame = layered(frame, one.shot.motion.frames[index])
      keys.push(`1:${one.shot.name}:${index}`)
      if (nextAt !== null) changes.push(one.shot.startsAt + nextAt)
    }
  }
  pose.body = onPose(pack, style, frame, parts)
  // A part motion is the part's own: it runs from the spawn, whatever the state.
  for (const [slot, name] of Object.entries(parts)) {
    const motion = partOf(pack, slot, name)?.motion
    if (motion === undefined) continue
    const { index, nextAt } = frameAt(motion, now - row.startedAt, mode)
    const partFrame = motion.frames[index]!
    // A locked slot keeps its value: the part's own motion moves it, but does not swap it.
    pose.parts = { ...pose.parts, [slot]: style.locks.has(slot) ? { ...partFrame, swap: undefined } : partFrame }
    keys.push(`${slot}:${index}`)
    if (nextAt !== null) changes.push(row.startedAt + nextAt)
  }
  return { key: keys.join('|'), pose, nextAt: changes.length > 0 ? Math.min(...changes) : null }
}
