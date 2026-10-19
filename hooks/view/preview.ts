// `/crabarium pack preview <name>`: the pane shows a pack instead of the
// agents. One figure plays each state's motion, and one figure wears each
// role's outfit. Pure: the time comes in as an argument.
import type { PackPreview } from '../../types'
import type { AgentRow, AgentStatus } from '../core/agents'
import { pickOutfit } from '../core/avatar/select'
import { ENTER_MS } from '../core/character'
import { DEFAULT_STATES } from '../core/pack/motions'
import type { CharacterState } from '../core/pack/pack'
import type { PackEntry } from '../core/pack/registry'
import { ROLES } from '../core/pack/schema'
import type { DrawnCharacter } from './frames'
import type { AgentLine, CharacterSize } from './layout'

export type { PackPreview }

/** How long a preview shows when the user does not end it. */
export const PREVIEW_MS = 60_000

// The states a figure can hold for a whole preview. `entering` lasts only
// ENTER_MS, so `working` shows its motion in its place.
const STATES: readonly { state: CharacterState; status: AgentStatus }[] = [
  { state: 'working', status: 'running' },
  { state: 'idle', status: 'waiting' },
  { state: 'finished', status: 'completed' },
  { state: 'failed', status: 'failed' },
]

export type PreviewModel = {
  title: string
  /** Why the pack cannot show: its errors, or that it is not installed. */
  problem: string | null
  lines: readonly AgentLine[]
  characters: readonly DrawnCharacter[]
}

function figure(id: string, status: AgentStatus, preview: NonNullable<PackPreview>): AgentRow {
  // The figure started before the preview, so it is past its entrance; an
  // ended figure ends when the preview starts, so a one-shot pose plays.
  const startedAt = preview.startedAt - ENTER_MS
  const ended = status === 'completed' || status === 'failed'
  return {
    id,
    description: id,
    type: 'preview',
    model: '',
    parentId: null,
    isTeammate: false,
    status,
    statusAt: preview.startedAt,
    startedAt,
    endedAt: ended ? preview.startedAt : null,
  }
}

/** The preview at `now`, or `null` when none shows. */
export function previewModel(
  entries: readonly PackEntry[],
  preview: PackPreview,
  now: number,
  size: CharacterSize | null,
): PreviewModel | null {
  if (preview === null || now >= preview.until) return null
  const title = `Preview ${preview.pack}`
  const entry = entries.find(e => e.name === preview.pack)
  if (entry === undefined) return { title, problem: `pack ${JSON.stringify(preview.pack)} is not installed`, lines: [], characters: [] }
  if (!entry.result.ok) {
    return {
      title,
      problem: `pack ${JSON.stringify(preview.pack)} is not valid: run /crabarium pack check ${preview.pack}`,
      lines: [],
      characters: [],
    }
  }
  const { pack } = entry.result
  const defaults = pack.defaults?.parts ?? {}
  const lines: AgentLine[] = []
  const characters: DrawnCharacter[] = []
  const add = (id: string, description: string, detail: string, status: AgentStatus, parts: Readonly<Record<string, string>>): void => {
    lines.push({ id, description, status, detail, character: size })
    if (size !== null) characters.push({ id, size, row: figure(id, status, preview), pack, parts })
  }
  for (const { state, status } of STATES) {
    const motion = pack.states?.[state] ?? DEFAULT_STATES[state] ?? 'still'
    add(`preview:state:${state}`, `state ${state}`, `motion ${motion}`, status, defaults)
  }
  for (const role of ROLES) {
    const outfits = pack.roles?.[role]
    const parts = outfits === undefined ? null : pickOutfit(pack, outfits, `preview:${role}`)
    if (parts === null) continue
    const outfit = Object.entries(parts).map(([slot, name]) => `${slot}:${name}`)
    const more = outfits!.length > 1 ? [`${outfits!.length} outfits`] : []
    add(`preview:role:${role}`, `role ${role}`, [...outfit, ...more].join(' · '), 'running', parts)
  }
  return { title, problem: null, lines, characters }
}
