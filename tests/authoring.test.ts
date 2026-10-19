import { describe, expect, test } from 'claude-code/testing'

import { compose, parsePack } from '../hooks/core/pack/pack.ts'
import type { Pack } from '../hooks/core/pack/pack.ts'
import { builtinPack } from '../hooks/view/avatar.ts'
import { GLYPH_HEIGHT, GLYPH_WIDTH, GLYPHS } from '../skills/pack-authoring/scripts/font.ts'
import { LIBRARY } from '../skills/pack-authoring/scripts/library.ts'
import { lintPack } from '../skills/pack-authoring/scripts/lint.ts'
import type { Finding } from '../skills/pack-authoring/scripts/lint.ts'
import { addPart, missingKeys } from '../skills/pack-authoring/scripts/parts.ts'
import { decodePng, encodePng } from '../skills/pack-authoring/scripts/png.ts'
import type { Zlib } from '../skills/pack-authoring/scripts/png.ts'
import { contactSheet, TERMINAL_SCALE } from '../skills/pack-authoring/scripts/sheet.ts'
import type { Image } from '../skills/pack-authoring/scripts/sheet.ts'
import { trace } from '../skills/pack-authoring/scripts/trace.ts'

// The engine has no zlib, so the tests use deflate's stored blocks: valid
// zlib data with no compression.
function adler32(data: Uint8Array): number {
  let [a, b] = [1, 0]
  for (const byte of data) [a, b] = [(a + byte) % 65521, (b + (a + byte)) % 65521]
  return ((b << 16) | a) >>> 0
}
const storedZlib: Zlib = {
  deflate(data) {
    const blocks: number[] = [0x78, 0x01]
    for (let at = 0; at < data.length || at === 0; at += 65535) {
      const block = data.subarray(at, at + 65535)
      const last = at + 65535 >= data.length ? 1 : 0
      blocks.push(last, block.length & 0xff, block.length >> 8, ~block.length & 0xff, (~block.length >> 8) & 0xff, ...block)
      if (data.length === 0) break
    }
    const sum = adler32(data)
    return new Uint8Array([...blocks, sum >>> 24, (sum >> 16) & 0xff, (sum >> 8) & 0xff, sum & 0xff])
  },
  inflate(data) {
    const out: number[] = []
    for (let at = 2; ;) {
      const last = data[at]! & 1
      const length = data[at + 1]! | (data[at + 2]! << 8)
      out.push(...data.subarray(at + 5, at + 5 + length))
      at += 5 + length
      if (last) break
    }
    return new Uint8Array(out)
  },
}

function pixel(image: Image, x: number, y: number): number {
  const i = (y * image.width + x) * 4
  return (image.data[i]! << 16) | (image.data[i + 1]! << 8) | image.data[i + 2]!
}

function packOf(json: unknown): Pack {
  const result = parsePack(json)
  if (!result.ok) throw new Error(result.errors.map(e => `${e.path} ${e.message}`).join('; '))
  return result.pack
}

// A body with room above the head and right of the hand, 2 x 2 eyes on even
// coordinates (so they stay at the small size), and all three anchors.
const BODY = {
  formatVersion: 1,
  name: 'body',
  author: 'test',
  license: 'MIT',
  grid: { width: 20, height: 16 },
  palette: { o: '#e4572e', k: '#1b1b1b' },
  anchors: { head: [8, 8], handR: [14, 10], handL: [1, 10], back: [2, 11] },
  groups: {
    body: { at: [2, 8], rows: ['oooooooooooo', 'oooooooooooo', 'oooooooooooo', 'oooooooooooo', 'o.o......o.o', 'o.o......o.o'] },
    eyes: { at: [4, 10], rows: ['kk....kk', 'kk....kk'] },
  },
}

function rules(findings: readonly Finding[]): string[] {
  return findings.map(f => f.rule)
}

describe('font', () => {
  test('each glyph is 3 x 5', () => {
    for (const rows of Object.values(GLYPHS)) {
      expect(rows.length).toBe(GLYPH_HEIGHT)
      for (const row of rows) expect(row.length).toBe(GLYPH_WIDTH)
    }
  })
})

describe('png', () => {
  test('a sheet survives encode and decode', () => {
    const sheet = contactSheet(builtinPack('minimal'), { mode: 'critic' })
    const back = decodePng(encodePng(sheet, storedZlib), storedZlib)
    expect([back.width, back.height]).toEqual([sheet.width, sheet.height])
    expect([...back.data]).toEqual([...sheet.data])
  })

  test('decodes each row filter (Sub, Up, Average, Paeth) and a palette', () => {
    // 2 x 4 RGB, each row with another filter, built by hand.
    const raw = [
      [1, 10, 20, 30, 5, 5, 5], // Sub: second pixel is first + 5
      [2, 0, 0, 0, 0, 0, 0], // Up: same as the row above
      [3, 5, 10, 15, 5, 5, 5], // Average
      [4, 0, 0, 0, 0, 0, 0], // Paeth: copies the best neighbour
    ].flat()
    const png = encodeRaw(2, 4, 2, new Uint8Array(raw))
    const image = decodePng(png, storedZlib)
    expect(pixel(image, 0, 0)).toBe(0x0a141e)
    expect(pixel(image, 1, 0)).toBe(0x0f1923)
    expect(pixel(image, 1, 1)).toBe(0x0f1923)
    // Average: first pixel 5 + floor(up / 2) = 5 + 5, 10 + 10, 15 + 15.
    expect(pixel(image, 0, 2)).toBe(0x0a141e)
    expect(pixel(image, 1, 3)).toBe(pixel(image, 1, 2))
  })

  test('says why it refuses an interlaced file', () => {
    const png = encodeRaw(1, 1, 2, new Uint8Array([0, 1, 2, 3]), 1)
    expect(() => decodePng(png, storedZlib)).toThrow(/interlaced/)
  })
})

// A PNG with the given color type and interlace, from scanlines that already carry their filter byte.
function encodeRaw(width: number, height: number, type: number, raw: Uint8Array, interlace = 0): Uint8Array {
  const base = encodePng({ width, height, data: new Uint8Array(width * height * 4) }, storedZlib)
  const out = [...base.subarray(0, 8)]
  const chunk = (name: string, data: number[]) => {
    const body = [...name].map(c => c.charCodeAt(0)).concat(data)
    out.push(data.length >>> 24, (data.length >> 16) & 0xff, (data.length >> 8) & 0xff, data.length & 0xff, ...body, 0, 0, 0, 0)
  }
  chunk('IHDR', [0, 0, 0, width, 0, 0, 0, height, 8, type, 0, 0, interlace])
  chunk('IDAT', [...storedZlib.deflate(raw)])
  chunk('IEND', [])
  return new Uint8Array(out)
}

describe('contact sheet', () => {
  test('the critic sheet shows each outfit at terminal size, on dark then light', () => {
    const pack = builtinPack('minimal')
    const sheet = contactSheet(pack, { mode: 'critic' })
    const gap = TERMINAL_SCALE * 2
    // minimal: 8 outfits (default, 6 roles, planner has 2).
    expect(sheet.width).toBe(gap + 8 * (16 * TERMINAL_SCALE + gap))
    expect(sheet.height).toBe(2 * (8 * TERMINAL_SCALE + 2 * gap))
    // The left claw starts at (0, 1).
    expect(pixel(sheet, gap, gap + TERMINAL_SCALE)).toBe(0xe4572e)
    expect(pixel(sheet, gap, gap)).toBe(0x1e1e1e)
    expect(pixel(sheet, gap, sheet.height / 2 + gap)).toBe(0xf4f4f4)
  })
})

describe('lint', () => {
  test('a clean body has no findings but the roles it has no outfit for', () => {
    expect(rules(lintPack(packOf(BODY)))).toEqual(['no-outfit'])
  })

  test('speck and detached name the pixels', () => {
    const pack = packOf({
      ...BODY,
      groups: { ...BODY.groups, dust: { at: [0, 0], rows: ['o'] }, moon: { at: [12, 0], rows: ['ooo', 'ooo'] } },
    })
    const findings = lintPack(pack)
    expect(findings.find(f => f.rule === 'speck')?.message).toContain('(0,0)')
    expect(findings.find(f => f.rule === 'detached')?.message).toContain('6 pixels')
  })

  test('clipped names the pixels outside the grid', () => {
    const pack = packOf({
      ...BODY,
      parts: { hat: { tall: { anchor: 'head', pivot: [0, 10], rows: Array(10).fill('k') } } },
      defaults: { parts: { hat: 'tall' } },
    })
    const clip = lintPack(pack).find(f => f.rule === 'clipped')
    expect(clip?.severity).toBe('error')
    expect(clip?.message).toContain('(8,-2)')
  })

  test('covers-eyes names the part and the eye pixels', () => {
    const pack = packOf({
      ...BODY,
      parts: { held: { mask: { anchor: 'head', pivot: [4, 0], rows: ['......', '......', 'mmmmmm'], palette: { m: '#3b6fd6' } } } },
      roles: { tester: [{ parts: { held: 'mask' } }] },
    })
    const finding = lintPack(pack).find(f => f.rule === 'covers-eyes')
    expect(finding?.message).toContain('held:mask')
    expect(finding?.message).toContain('(4,10)')
  })

  test('same-look: two roles in outfits that differ in too few pixels', () => {
    const parts = {
      hat: {
        a: { anchor: 'head', pivot: [0, 1], rows: ['k'] },
        b: { anchor: 'head', pivot: [0, 1], rows: ['k'], palette: { k: '#1c1c1c' } },
      },
    }
    const pack = packOf({ ...BODY, parts, roles: { reviewer: [{ parts: { hat: 'a' } }], tester: [{ parts: { hat: 'b' } }] } })
    const finding = lintPack(pack).find(f => f.rule === 'same-look' && f.severity === 'error')
    expect(finding?.where).toBe('roles.tester')
  })

  test('close-colors and unused palette keys', () => {
    const pack = packOf({
      ...BODY,
      palette: { ...BODY.palette, p: '#e5582f', z: '#00ff00' },
      groups: { ...BODY.groups, mark: { at: [7, 12], rows: ['p'] } },
    })
    const findings = lintPack(pack)
    expect(findings.find(f => f.rule === 'close-colors')?.message).toContain('"p"')
    expect(findings.find(f => f.rule === 'unused' && f.where === 'palette')?.message).toContain('z')
  })

  test('contrast: a white part is gone on a light terminal', () => {
    const pack = packOf({
      ...BODY,
      parts: { hat: { wig: { anchor: 'head', pivot: [1, 2], rows: ['www', 'www'], palette: { w: '#f2f2f2' } } } },
      defaults: { parts: { hat: 'wig' } },
    })
    const finding = lintPack(pack).find(f => f.rule === 'contrast')
    expect(finding?.where).toBe('parts.hat.wig')
    expect(finding?.severity).toBe('error')
    expect(finding?.message).toContain('light')
  })

  test('small-size: 2 x 2 eyes on odd coordinates go away at half size', () => {
    const pack = packOf({ ...BODY, groups: { ...BODY.groups, eyes: { at: [5, 9], rows: ['kk....kk', 'kk....kk'] } } })
    expect(lintPack(pack).find(f => f.rule === 'small-size')?.message).toContain('#1b1b1b')
  })

  test('no-move and repeat-frame', () => {
    const still = { fps: 2, loop: true, frames: [{}, {}] }
    const stutter = { fps: 2, loop: true, frames: [{}, {}, { offset: { '*': [0, -1] } }] }
    const pack = packOf({ ...BODY, motions: { still, stutter }, states: { idle: 'still', working: 'stutter' } })
    const findings = lintPack(pack)
    expect(findings.find(f => f.rule === 'no-move')?.where).toBe('motions.still')
    expect(findings.find(f => f.rule === 'repeat-frame')?.where).toBe('motions.stutter.frames[1]')
  })
})

describe('library', () => {
  for (const entry of LIBRARY) {
    test(`${entry.slot}-${entry.name} gives its colors, fits a body on its anchor, and stays visible`, () => {
      expect(missingKeys(entry.part)).toEqual([])
      const added = addPart(packOf(BODY), entry, { roles: ['reviewer'] })
      if (!added.ok) throw new Error(added.errors.map(e => e.message).join('; '))
      // The part alone: its first pixel lands at anchor - pivot + its place in the rows.
      const anchor = added.pack.anchors![entry.part.anchor]!
      const y = entry.part.rows.findIndex(row => /[^.]/.test(row))
      const x = entry.part.rows[y]!.search(/[^.]/)
      const alone = compose({ ...added.pack, groups: {} }, { [entry.slot]: entry.name })
      const at = (anchor[1] - entry.part.pivot[1] + y) * added.pack.grid.width + anchor[0] - entry.part.pivot[0] + x
      expect(alone.pixels[at]).toBe(Number.parseInt(entry.part.palette![entry.part.rows[y]![x]!]!.slice(1), 16))
      const problems = lintPack(added.pack).filter(
        f => f.where === `parts.${entry.slot}.${entry.name}` || f.rule === 'clipped' || f.rule === 'covers-eyes',
      )
      expect(problems).toEqual([])
    })
  }

  test('add-part puts the part into each outfit of a role, and refuses a second part of the same name', () => {
    const pack = packOf({ ...BODY, parts: { held: {} }, roles: { reviewer: [{ parts: {} }, { parts: {}, weight: 2 }] } })
    const wig = LIBRARY.find(p => p.name === 'wig')!
    const added = addPart(pack, wig, { roles: ['reviewer'] })
    if (!added.ok) throw new Error('not added')
    expect(added.pack.roles?.reviewer?.map(o => o.parts.hat)).toEqual(['wig', 'wig'])
    expect(pack.roles?.reviewer?.[0]?.parts).toEqual({})
    const again = addPart(added.pack, wig)
    expect(again.ok ? '' : again.errors[0]!.path).toBe('parts.hat.wig')
  })

  test('add-part names a missing anchor and an unknown role', () => {
    const noHead = packOf({ ...BODY, anchors: { handR: [14, 10] } })
    const wizard = LIBRARY.find(p => p.name === 'wizard')!
    const missing = addPart(noHead, wizard)
    expect(missing.ok ? '' : missing.errors[0]!.path).toBe('parts.hat.wizard.anchor')
    const role = addPart(packOf(BODY), wizard, { roles: ['judge'] })
    expect(role.ok ? '' : role.errors[0]!.message).toContain('not a role')
  })
})

describe('trace', () => {
  test('pixel art at 10x on white comes back exact, eyes and all', () => {
    const pack = builtinPack('minimal')
    const grid = compose(pack, { hat: 'cap' })
    const [s, m] = [10, 30]
    const width = grid.width * s + 2 * m
    const height = grid.height * s + 2 * m
    const data = new Uint8Array(width * height * 4).fill(255)
    grid.pixels.forEach((c, i) => {
      if (c === null) return
      for (let y = 0; y < s; y += 1) {
        for (let x = 0; x < s; x += 1)
          data.set(
            [c >> 16, (c >> 8) & 0xff, c & 0xff, 255],
            ((m + Math.floor(i / grid.width) * s + y) * width + m + (i % grid.width) * s + x) * 4,
          )
      }
    })
    const result = trace({ width, height, data }, { width: 16, height: 16, colors: 8 })
    expect([result.width, result.height]).toEqual([16, 8])
    const back = result.rows.flatMap(row => [...row].map(key => (key === '.' ? null : Number.parseInt(result.palette[key]!.slice(1), 16))))
    expect(back).toEqual([...grid.pixels])
  })

  test('an image of only background is an error', () => {
    const data = new Uint8Array(4 * 4 * 4).fill(255)
    expect(() => trace({ width: 4, height: 4, data }, { width: 4, height: 4, colors: 2 })).toThrow(/no subject/)
  })
})
