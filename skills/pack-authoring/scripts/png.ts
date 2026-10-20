// PNG encode and decode for the contact sheet and `trace`. Pure: the caller
// gives the deflate functions (node:zlib in the CLI), so the tests run
// without Node.
import type { Image } from './sheet.ts'

export type Zlib = { deflate: (data: Uint8Array) => Uint8Array; inflate: (data: Uint8Array) => Uint8Array }

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  out.set(
    [...type].map(c => c.charCodeAt(0)),
    4,
  )
  out.set(data, 8)
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

/** An 8-bit RGBA PNG, no filter on any row. */
export function encodePng(image: Image, zlib: Zlib): Uint8Array {
  const header = new Uint8Array(13)
  const view = new DataView(header.buffer)
  view.setUint32(0, image.width)
  view.setUint32(4, image.height)
  header.set([8, 6, 0, 0, 0], 8)
  const stride = image.width * 4
  const raw = new Uint8Array((stride + 1) * image.height)
  for (let y = 0; y < image.height; y += 1) raw.set(image.data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1)
  const parts = [new Uint8Array(SIGNATURE), chunk('IHDR', header), chunk('IDAT', zlib.deflate(raw)), chunk('IEND', new Uint8Array())]
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

// Channels of each color type at 8 bits: gray, -, RGB, palette, gray+alpha, -, RGBA.
const CHANNELS: Readonly<Record<number, number>> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }

/**
 * An RGBA image from a PNG: 8-bit gray, RGB, gray with alpha, RGBA, or a
 * palette of up to 8 bits. No interlace, no 16-bit: such a file is an error
 * that says so.
 */
export function decodePng(bytes: Uint8Array, zlib: Zlib): Image {
  if (SIGNATURE.some((b, i) => bytes[i] !== b)) throw new Error('not a PNG file')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let width = 0
  let height = 0
  let depth = 0
  let type = 0
  let palette: Uint8Array = new Uint8Array()
  let alpha: Uint8Array = new Uint8Array()
  const idat: Uint8Array[] = []
  for (let at = 8; at + 8 <= bytes.length;) {
    const length = view.getUint32(at)
    const name = String.fromCharCode(...bytes.subarray(at + 4, at + 8))
    const data = bytes.subarray(at + 8, at + 8 + length)
    if (name === 'IHDR') {
      width = view.getUint32(at + 8)
      height = view.getUint32(at + 12)
      depth = data[8]!
      type = data[9]!
      if (data[12] !== 0) throw new Error('interlaced PNG files are not supported; save it without interlace')
    } else if (name === 'PLTE') palette = data
    else if (name === 'tRNS') alpha = data
    else if (name === 'IDAT') idat.push(data)
    else if (name === 'IEND') break
    at += 12 + length
  }
  const channels = CHANNELS[type]
  if (channels === undefined) throw new Error(`PNG color type ${type} is not supported`)
  if (depth !== 8 && !(type === 3 && [1, 2, 4].includes(depth)))
    throw new Error(`PNG bit depth ${depth} is not supported; save it as 8-bit`)

  const joined = new Uint8Array(idat.reduce((n, d) => n + d.length, 0))
  idat.reduce((at, d) => (joined.set(d, at), at + d.length), 0)
  const raw = zlib.inflate(joined)
  const bpp = Math.max(1, (channels * depth) / 8)
  const stride = Math.ceil((width * channels * depth) / 8)
  const rows = new Uint8Array(stride * height)
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)]!
    for (let x = 0; x < stride; x += 1) {
      const value = raw[y * (stride + 1) + 1 + x]!
      const a = x >= bpp ? rows[y * stride + x - bpp]! : 0
      const b = y > 0 ? rows[(y - 1) * stride + x]! : 0
      const c = x >= bpp && y > 0 ? rows[(y - 1) * stride + x - bpp]! : 0
      const predictor = [0, a, b, (a + b) >> 1, paeth(a, b, c)][filter]
      if (predictor === undefined) throw new Error(`bad PNG filter ${filter}`)
      rows[y * stride + x] = (value + predictor) & 0xff
    }
  }

  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const o = (y * width + x) * 4
      const s = y * stride + x * channels
      if (type === 3) {
        const perByte = 8 / depth
        const byte = rows[y * stride + Math.floor(x / perByte)]!
        const index = (byte >> ((perByte - 1 - (x % perByte)) * depth)) & ((1 << depth) - 1)
        data.set([palette[index * 3] ?? 0, palette[index * 3 + 1] ?? 0, palette[index * 3 + 2] ?? 0, alpha[index] ?? 0xff], o)
      } else if (type === 0 || type === 4) {
        const g = rows[s]!
        data.set([g, g, g, type === 4 ? rows[s + 1]! : 0xff], o)
      } else {
        data.set([rows[s]!, rows[s + 1]!, rows[s + 2]!, type === 6 ? rows[s + 3]! : 0xff], o)
      }
    }
  }
  return { width, height, data }
}
