// `trace`: an image to pack rows, as a draft for the author to clean up. It
// suits a source that is already pixel art or flat art; a photo at 16 pixels
// is noise. Pure.
import { colorDistance } from './lint.ts'
import type { Image } from './sheet.ts'

export type TraceOptions = { width: number; height: number; colors: number }
export type Trace = { width: number; height: number; rows: string[]; palette: Record<string, string> }

// Palette keys in the order a trace uses them; "." is transparent.
const KEYS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

const rgb = (data: Uint8Array, i: number): number => (data[i * 4]! << 16) | (data[i * 4 + 1]! << 8) | data[i * 4 + 2]!

/**
 * Which pixels are the subject: the alpha channel when the image has one;
 * else everything but the background that touches the border (its most
 * common border color, with a tolerance).
 */
export function subjectMask(image: Image): boolean[] {
  const { width, height, data } = image
  const n = width * height
  const mask = Array.from({ length: n }, (_, i) => data[i * 4 + 3]! >= 128)
  if (mask.some(m => !m)) return mask
  const border: number[] = []
  for (let x = 0; x < width; x += 1) border.push(x, (height - 1) * width + x)
  for (let y = 0; y < height; y += 1) border.push(y * width, y * width + width - 1)
  const counts = new Map<number, number>()
  for (const i of border) counts.set(rgb(data, i), (counts.get(rgb(data, i)) ?? 0) + 1)
  const background = [...counts].reduce((a, b) => (b[1] > a[1] ? b : a))[0]
  const stack = border.filter(i => colorDistance(rgb(data, i), background) < 48)
  for (const i of stack) mask[i] = false
  while (stack.length > 0) {
    const i = stack.pop()!
    const x = i % width
    const y = Math.floor(i / width)
    for (const [nx, ny] of [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ] as const) {
      const j = ny * width + nx
      if (nx < 0 || ny < 0 || nx >= width || ny >= height || mask[j] !== true) continue
      if (colorDistance(rgb(data, j), background) >= 48) continue
      mask[j] = false
      stack.push(j)
    }
  }
  return mask
}

const channel = (c: number, ch: number): number => (c >> (16 - 8 * ch)) & 0xff

/** Median cut: at most `k` colors that stand for `colors`. */
export function medianCut(colors: readonly number[], k: number): number[] {
  let boxes: number[][] = colors.length === 0 ? [] : [[...colors]]
  while (boxes.length < k) {
    const spans = boxes.map(box =>
      [0, 1, 2].map(ch => {
        let [lo, hi] = [255, 0]
        for (const c of box) [lo, hi] = [Math.min(lo, channel(c, ch)), Math.max(hi, channel(c, ch))]
        return hi - lo
      }),
    )
    const widest = spans.reduce((best, s, i) => (Math.max(...s) > Math.max(...spans[best]!) ? i : best), 0)
    const span = spans[widest]!
    if (Math.max(...span) === 0) break
    const ch = span.indexOf(Math.max(...span))
    const box = boxes[widest]!.toSorted((a, b) => channel(a, ch) - channel(b, ch))
    const half = Math.floor(box.length / 2)
    boxes = [...boxes.slice(0, widest), box.slice(0, half), box.slice(half), ...boxes.slice(widest + 1)]
  }
  return boxes.map(box => {
    const mean = (ch: number) => Math.round(box.reduce((s, c) => s + channel(c, ch), 0) / box.length)
    return (mean(0) << 16) | (mean(1) << 8) | mean(2)
  })
}

/** The subject of `image`, cropped and fitted into the grid with its aspect, in at most `colors` colors. */
export function trace(image: Image, options: TraceOptions): Trace {
  const mask = subjectMask(image)
  const opaque = mask.flatMap((m, i) => (m ? [i] : []))
  if (opaque.length === 0) throw new Error('the image has no subject: it is all background')
  // A loop, not Math.min(...): a large image has more pixels than a call has arguments.
  let [left, top, right, bottom] = [image.width, image.height, 0, 0]
  for (const i of opaque) {
    const x = i % image.width
    const y = Math.floor(i / image.width)
    ;[left, top, right, bottom] = [Math.min(left, x), Math.min(top, y), Math.max(right, x), Math.max(bottom, y)]
  }
  const [w, h] = [right - left + 1, bottom - top + 1]
  const scale = Math.max(w / options.width, h / options.height, 1)
  const outW = Math.max(1, Math.round(w / scale))
  const outH = Math.max(1, Math.round(h / scale))

  // Each cell takes the most common color of its box (5 bits a channel), so
  // the hard edges of pixel art stay hard; it is opaque when half its box is.
  const cells: (number | null)[] = []
  for (let cy = 0; cy < outH; cy += 1) {
    for (let cx = 0; cx < outW; cx += 1) {
      const buckets = new Map<number, number[]>()
      let total = 0
      for (let y = Math.floor(top + cy * scale); y < Math.min(top + h, Math.floor(top + (cy + 1) * scale)); y += 1) {
        for (let x = Math.floor(left + cx * scale); x < Math.min(left + w, Math.floor(left + (cx + 1) * scale)); x += 1) {
          total += 1
          const i = y * image.width + x
          if (mask[i] !== true) continue
          const c = rgb(image.data, i)
          const bucket = ((c >> 19) << 10) | (((c >> 11) & 0x1f) << 5) | ((c >> 3) & 0x1f)
          buckets.set(bucket, [...(buckets.get(bucket) ?? []), c])
        }
      }
      const inside = [...buckets.values()].reduce((s, b) => s + b.length, 0)
      if (inside * 2 < Math.max(total, 1)) {
        cells.push(null)
        continue
      }
      const best = [...buckets.values()].reduce((a, b) => (b.length > a.length ? b : a))
      cells.push(medianCut(best, 1)[0]!)
    }
  }

  const opaqueCells = cells.filter((c): c is number => c !== null)
  const limit = Math.min(options.colors, KEYS.length)
  const distinct = [...new Set(opaqueCells)]
  // Pixel art has few exact colors: keep them, so that a 2-pixel eye does
  // not merge into the larger color next to it.
  const palette = distinct.length <= limit ? distinct : medianCut(opaqueCells, limit)
  const nearest = (c: number) => palette.reduce((best, p, i) => (colorDistance(c, p) < colorDistance(c, palette[best]!) ? i : best), 0)
  const rows: string[] = []
  for (let y = 0; y < outH; y += 1) {
    rows.push(
      cells
        .slice(y * outW, (y + 1) * outW)
        .map(c => (c === null ? '.' : KEYS[nearest(c)]!))
        .join(''),
    )
  }
  const used = new Set(rows.join(''))
  return {
    width: outW,
    height: outH,
    rows,
    palette: Object.fromEntries(palette.flatMap((c, i) => (used.has(KEYS[i]!) ? [[KEYS[i]!, `#${c.toString(16).padStart(6, '0')}`]] : []))),
  }
}
