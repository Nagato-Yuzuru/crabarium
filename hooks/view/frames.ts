// The frame loop of the pane: it repaints the characters with `$.ui.blit`.
// It wakes at the next frame change of any character, blits only the
// characters whose cells changed, and stops when no character moves or when
// the pane goes away. Only the terminal draws Rasters.
import { atom, read } from 'claude-code'
import type { EngineInterface, Timer } from 'claude-code'

import { initialAgents } from '../core/agents'
import type { AgentBoard } from '../core/agents'
import type { MotionMode } from '../core/character'
import { PANE_ID } from '../state'
import { avatarFrame } from './avatar'
import type { RasterImage } from './avatar'

const agents = atom({ plugin: 'crabarium', key: 'agents' } as const, initialAgents)

export function avatarKey(id: string): string {
  return `avatar-${id}`
}

/** The cells of each row's character at `now`, and the time of the next frame change of any of them. */
export type FramePlan = { images: Map<string, RasterImage>; nextAt: number | null }

export function framePlan(board: AgentBoard, now: number, mode: MotionMode): FramePlan {
  const images = new Map<string, RasterImage>()
  let nextAt: number | null = null
  for (const row of board.rows) {
    const frame = avatarFrame(row, now, mode)
    images.set(row.id, frame.image)
    if (frame.nextAt !== null) nextAt = nextAt === null ? frame.nextAt : Math.min(nextAt, frame.nextAt)
  }
  return { images, nextAt }
}

// The module's own state: a hot reload drops it with the timer, and the next
// render starts the loop again.
let timer: Timer | null = null
// Each render and each stop starts a new generation. A tick that awaited
// across one is stale: it changes nothing and does not wake the loop again.
let generation = 0
// The cells that each mounted Raster shows now, by Raster key.
const shown = new Map<string, string>()

export function stopFrames(): void {
  generation += 1
  timer?.cancel()
  timer = null
  shown.clear()
}

function wakeAt($: EngineInterface, mode: MotionMode, nextAt: number | null, now: number): void {
  timer?.cancel()
  timer = null
  if (nextAt === null) return
  const current = generation
  timer = $.clock.after(Math.max(1, nextAt - now), () => {
    timer = null
    tick($, mode, current).catch((error: unknown) => {
      // A failed frame stops the loop, with one log line; the next render starts it again.
      stopFrames()
      $.ui.log(`crabarium: the frame loop stopped: ${error instanceof Error ? error.message : String(error)}`)
    })
  })
}

async function tick($: EngineInterface, mode: MotionMode, current: number): Promise<void> {
  const [board, now] = await Promise.all([read($, agents), $.clock.now()])
  const { images, nextAt } = framePlan(board, now, mode)
  const changed = [...images].filter(([id, image]) => shown.get(avatarKey(id)) !== image.cells)
  const results = await Promise.all(changed.map(([id, image]) => $.ui.blit({ requestId: PANE_ID, key: avatarKey(id), cells: image.cells })))
  if (current !== generation) return
  // A deny means that the pane is not mounted: it closed, or it waits for room.
  // Each mount renders the pane, and the render starts the loop again.
  if (results.some(r => r.deny !== undefined)) {
    stopFrames()
    return
  }
  for (const [id, image] of changed) shown.set(avatarKey(id), image.cells)
  wakeAt($, mode, nextAt, now)
}

/** Records what a render drew at `now`, and wakes the loop at the next frame change (or stops it). */
export function framesDrawn($: EngineInterface, mode: MotionMode, plan: FramePlan, now: number): void {
  generation += 1
  shown.clear()
  for (const [id, image] of plan.images) shown.set(avatarKey(id), image.cells)
  wakeAt($, mode, plan.nextAt, now)
}
