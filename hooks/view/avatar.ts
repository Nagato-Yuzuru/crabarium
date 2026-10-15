// The character art that the pane draws for an agent row.
import { compose, parsePackText } from '../core/pack/pack'
import type { Pack } from '../core/pack/pack'
import { builtinPackTexts } from '../packs.generated'
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

let cached: RasterImage | undefined

/** The default character as Raster props. Each agent shows the same one until avatar selection exists. */
export function defaultAvatar(): RasterImage {
  if (cached === undefined) {
    const { columns, rows, words } = halfBlockCells(compose(builtinPack(DEFAULT_PACK)))
    cached = { columns, rows, cells: cellsBase64(words) }
  }
  return cached
}
