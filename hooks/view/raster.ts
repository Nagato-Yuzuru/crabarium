// Pixel grid -> Raster cells. Each terminal cell shows two pixels, one above
// the other, with half-block characters. Pure: no engine calls.
import type { PixelGrid } from '../core/pack/pack.ts'

/** The Raster color word for the terminal's default color. */
export const DEFAULT_COLOR = 0x01000000

const UPPER_HALF = 0x2580 // ▀
const LOWER_HALF = 0x2584 // ▄
const SPACE = 0x20

/** Raster cells before base64: `[codePoint, foreground, background]` for each cell, row-major. */
export type CellWords = { columns: number; rows: number; words: Uint32Array }

// A transparent pixel must show the pane background, and only the default
// background color does that. So in a cell with one opaque pixel, that pixel
// is the foreground of the half block on its side.
function cell(top: number | null, bottom: number | null): readonly [number, number, number] {
  if (top === null && bottom === null) return [SPACE, DEFAULT_COLOR, DEFAULT_COLOR]
  if (top === null) return [LOWER_HALF, bottom!, DEFAULT_COLOR]
  return [UPPER_HALF, top, bottom ?? DEFAULT_COLOR]
}

export function halfBlockCells(grid: PixelGrid): CellWords {
  const columns = grid.width
  const rows = Math.ceil(grid.height / 2)
  const words = new Uint32Array(columns * rows * 3)
  const at = (x: number, y: number): number | null => (y < grid.height ? (grid.pixels[y * columns + x] ?? null) : null)
  for (let row = 0; row < rows; row += 1) {
    for (let x = 0; x < columns; x += 1) {
      words.set(cell(at(x, row * 2), at(x, row * 2 + 1)), (row * columns + x) * 3)
    }
  }
  return { columns, rows, words }
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

// The Raster `cells` prop: padded base64 of the words, little-endian. This
// does not use `Uint8Array.prototype.toBase64`, because the test runner and
// the TypeScript lib do not all have it.
export function cellsBase64(words: Uint32Array): string {
  const bytes = new Uint8Array(words.length * 4)
  const view = new DataView(bytes.buffer)
  words.forEach((word, i) => view.setUint32(i * 4, word, true))
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    out += BASE64[(n >> 18) & 63]! + BASE64[(n >> 12) & 63]!
    out += i + 1 < bytes.length ? BASE64[(n >> 6) & 63]! : '='
    out += i + 2 < bytes.length ? BASE64[n & 63]! : '='
  }
  return out
}
