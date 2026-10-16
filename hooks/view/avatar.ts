// The character art that the pane draws for an agent row.
import type { AgentRow } from '../core/agents'
import { characterPose } from '../core/character'
import type { MotionMode } from '../core/character'
import { compose, halve, parsePackText } from '../core/pack/pack'
import type { Pack } from '../core/pack/pack'
import { builtinPackTexts } from '../packs.generated'
import type { CharacterSize } from './layout'
import { cellsBase64, halfBlockCells } from './raster'

export const DEFAULT_PACK = 'minimal'

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

let pack: Pack | undefined
// One entry for each pose. Part motions multiply the poses, so the cache
// starts again when it is full.
const images = new Map<string, RasterImage>()
const MAX_IMAGES = 1024

/**
 * The default character of an agent at `now`, full size or half size. Each
 * agent uses the default pack until avatar selection exists.
 */
export function avatarFrame(row: AgentRow, now: number, mode: MotionMode, size: CharacterSize = 'full'): AvatarFrame {
  pack ??= builtinPack(DEFAULT_PACK)
  const selection = pack.defaults?.parts ?? {}
  const { key, pose, nextAt } = characterPose(pack, selection, row, now, mode)
  const cacheKey = `${size}:${key}`
  let image = images.get(cacheKey)
  if (image === undefined) {
    if (images.size >= MAX_IMAGES) images.clear()
    const grid = compose(pack, selection, pose)
    const { columns, rows, words } = halfBlockCells(size === 'full' ? grid : halve(grid))
    image = { columns, rows, cells: cellsBase64(words) }
    images.set(cacheKey, image)
  }
  return { image, nextAt }
}
