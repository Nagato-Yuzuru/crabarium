// The character art that the pane draws for an agent row.
import type { AgentRow } from '../core/agents'
import { DEFAULT_PACK } from '../core/avatar/settings'
import { characterPose } from '../core/character'
import type { MotionMode } from '../core/character'
import { compose, halve, parsePackText } from '../core/pack/pack'
import type { Pack, PartSelection } from '../core/pack/pack'
import { builtinPackTexts } from '../packs.generated'
import type { CharacterSize } from './layout'
import { cellsBase64, halfBlockCells } from './raster'

/** A built-in pack. The tests parse each one, so a failure here is a bug in the repository. */
export function builtinPack(name: string): Pack {
  const text = builtinPackTexts[name]
  if (text === undefined) throw new Error(`no built-in pack ${name}`)
  const result = parsePackText(text)
  if (!result.ok) throw new Error(`built-in pack ${name}: ${result.errors.map(e => `${e.path} ${e.message}`).join('; ')}`)
  return result.pack
}

export type RasterImage = { columns: number; rows: number; cells: string }

/** A character as Raster props, and the time of its next frame change (`null`: it stands still). */
export type AvatarFrame = { image: RasterImage; nextAt: number | null }

// One entry for each pack, outfit, size and pose. Part motions multiply the
// poses, so the cache starts again when it is full.
const images = new Map<string, RasterImage>()
const MAX_IMAGES = 1024
// A pack object stands for its text: the registry parses a text once.
const packIds = new WeakMap<Pack, number>()
let nextPackId = 0

function packId(pack: Pack): number {
  let id = packIds.get(pack)
  if (id === undefined) {
    id = nextPackId
    nextPackId += 1
    packIds.set(pack, id)
  }
  return id
}

/** The built-in default pack, parsed once. */
let defaultPack: Pack | undefined
export function fallbackPack(): { name: string; pack: Pack } {
  defaultPack ??= builtinPack(DEFAULT_PACK)
  return { name: DEFAULT_PACK, pack: defaultPack }
}

/** The character of an agent in an outfit at `now`, full size or half size. */
export function avatarFrame(
  pack: Pack,
  parts: PartSelection,
  row: AgentRow,
  now: number,
  mode: MotionMode,
  size: CharacterSize = 'full',
): AvatarFrame {
  const { key, pose, nextAt } = characterPose(pack, parts, row, now, mode)
  const outfit = Object.entries(parts)
    .map(([slot, name]) => `${slot}:${name}`)
    .toSorted()
    .join(',')
  const cacheKey = `${packId(pack)}|${outfit}|${size}|${key}`
  let image = images.get(cacheKey)
  if (image === undefined) {
    if (images.size >= MAX_IMAGES) images.clear()
    const grid = compose(pack, parts, pose)
    const { columns, rows, words } = halfBlockCells(size === 'full' ? grid : halve(grid))
    image = { columns, rows, cells: cellsBase64(words) }
    images.set(cacheKey, image)
  }
  return { image, nextAt }
}
