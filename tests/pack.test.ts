import { describe, expect, test } from 'claude-code/testing'

import { compose, parsePack, parsePackText } from '../hooks/core/pack/pack.ts'
import type { Pack, PixelGrid } from '../hooks/core/pack/pack.ts'
import { packSchema } from '../hooks/core/pack/schema.ts'
import { validateSchema } from '../hooks/core/pack/validate.ts'
import { builtinPackTexts } from '../hooks/packs.generated.ts'
import { builtinPack } from '../hooks/view/avatar.ts'
import { cellsBase64, DEFAULT_COLOR, halfBlockCells } from '../hooks/view/raster.ts'
import { packFixtures, validPack } from './fixtures/packs.ts'

const RED = 0xff0000
const GREEN = 0x00ff00
const BLUE = 0x0000ff

function errorsOf(json: unknown): ReadonlyArray<{ path: string; message: string }> {
  const result = parsePack(json)
  return result.ok ? [] : result.errors
}

describe('pack fixtures (Ajv checks the same fixtures against schema/pack.schema.json)', () => {
  for (const fixture of packFixtures) {
    test(`${fixture.name}: schema ${fixture.schemaValid ? 'accepts' : 'rejects'}, pack ${fixture.packValid ? 'accepts' : 'rejects'}`, () => {
      expect(validateSchema(packSchema, fixture.json).length === 0).toBe(fixture.schemaValid)
      expect(parsePack(fixture.json).ok).toBe(fixture.packValid)
    })
  }
})

describe('parsePack errors name the field', () => {
  test('a grid over the limit', () => {
    expect(errorsOf({ ...validPack, grid: { width: 33, height: 3 } })).toEqual([
      { path: 'grid.width', message: 'must be at most 32, not 33' },
    ])
  })

  test('a missing field', () => {
    const { license: _license, ...rest } = validPack
    expect(errorsOf(rest)).toEqual([{ path: 'license', message: 'is required' }])
  })

  test('an unknown field', () => {
    expect(errorsOf({ ...validPack, script: 'x' })).toEqual([{ path: 'script', message: 'is not a known field' }])
  })

  test('a pixel key that is not in the palette names the row and the column', () => {
    const pack = { ...validPack, groups: { body: { at: [0, 1], rows: ['aaxa', 'a..a'] } } }
    expect(errorsOf(pack)).toEqual([{ path: 'groups.body.rows[0]', message: 'column 2: "x" is not in the palette' }])
  })

  test('a part key can come from the part palette, but not from another part', () => {
    const parts = {
      hat: {
        dot: { anchor: 'head', pivot: [0, 0], rows: ['c'], palette: { c: '#0000ff' } },
        bad: { anchor: 'head', pivot: [0, 0], rows: ['c'] },
      },
    }
    expect(errorsOf({ ...validPack, parts })).toEqual([{ path: 'parts.hat.bad.rows[0]', message: 'column 0: "c" is not in the palette' }])
  })

  test('a group outside the grid', () => {
    const pack = { ...validPack, groups: { body: { at: [1, 1], rows: ['aaaa'] } } }
    expect(errorsOf(pack)).toEqual([{ path: 'groups.body', message: 'the rows at [1, 1] go outside the 4 x 3 grid' }])
  })

  test('text that is not JSON', () => {
    const result = parsePackText('{ "name": ')
    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.errors[0]!.path).toBe('(root)')
  })
})

describe('compose', () => {
  const pack = validPack as unknown as Pack

  test('draws the groups, then the default part on its anchor', () => {
    expect(compose(pack)).toEqual({
      width: 4,
      height: 3,
      // prettier-ignore
      pixels: [
        null, null, BLUE, null,
        RED, RED, RED, RED,
        RED, null, null, RED,
      ],
    })
  })

  test('an empty selection draws no part', () => {
    expect(compose(pack, {}).pixels.slice(0, 4)).toEqual([null, null, null, null])
  })

  test('a slot or a part that the pack does not have draws nothing', () => {
    expect(compose(pack, { hat: 'crown', cape: 'red' })).toEqual(compose(pack, {}))
  })

  test('the pivot moves the part, and the grid clips what goes past its edge', () => {
    const wide: Pack = { ...pack, parts: { hat: { bar: { anchor: 'head', pivot: [1, 0], rows: ['ccccc'], palette: { c: '#0000ff' } } } } }
    expect(compose(wide, { hat: 'bar' }).pixels.slice(0, 4)).toEqual([null, BLUE, BLUE, BLUE])
  })

  test('a later group draws over an earlier one', () => {
    const layered: Pack = { ...pack, groups: { back: { at: [0, 0], rows: ['aa'] }, front: { at: [1, 0], rows: ['b'] } } }
    expect(compose(layered, {}).pixels.slice(0, 2)).toEqual([RED, GREEN])
  })
})

function cells(pixels: (number | null)[], width: number, height: number): number[] {
  return [...halfBlockCells({ width, height, pixels } satisfies PixelGrid).words]
}

describe('halfBlockCells', () => {
  test('maps each pair of pixels to one cell', () => {
    // Columns: both opaque, top only, bottom only, both transparent.
    // prettier-ignore
    expect(cells([RED, RED, null, null, GREEN, null, BLUE, null], 4, 2)).toEqual([
      0x2580, RED, GREEN,
      0x2580, RED, DEFAULT_COLOR,
      0x2584, BLUE, DEFAULT_COLOR,
      0x20, DEFAULT_COLOR, DEFAULT_COLOR,
    ])
  })

  test('an odd height leaves the last bottom half transparent', () => {
    const grid = halfBlockCells({ width: 1, height: 3, pixels: [RED, RED, BLUE] })
    expect([grid.columns, grid.rows]).toEqual([1, 2])
    expect([...grid.words].slice(3)).toEqual([0x2580, BLUE, DEFAULT_COLOR])
  })
})

describe('cellsBase64', () => {
  test('gives the padded base64 of the little-endian words', () => {
    expect(cellsBase64(Uint32Array.of(0x2588, 0xff8800, 0x01000000))).toBe('iCUAAACI/wAAAAAB')
  })

  test('pads one and two leftover bytes', () => {
    expect(cellsBase64(new Uint32Array(0))).toBe('')
    expect(cellsBase64(Uint32Array.of(0x00ffffff))).toBe('////AA==')
  })
})

describe('built-in packs', () => {
  for (const name of Object.keys(builtinPackTexts)) {
    test(`${name} is a valid pack`, () => {
      expect(parsePackText(builtinPackTexts[name]!)).toEqual(expect.objectContaining({ ok: true }))
    })
  }

  test('the minimal pack gives a fixed character', () => {
    const { columns, rows, words } = halfBlockCells(compose(builtinPack('minimal')))
    expect([columns, rows]).toEqual([16, 4])
    expect(cellsBase64(words)).toBe(MINIMAL_GOLDEN)
  })
})

// The minimal pack as Raster cells. Update it only on a deliberate art change.
const MINIMAL_GOLDEN =
  'hCUAAC5X5AAAAAABhCUAAC5X5AAAAAABIAAAAAAAAAEAAAABIAAAAAAAAAEAAAABIAAAAAAAAAEAAAABIAAAAAAAAAEAAAABIAAAAAAAAAEAAAABIAAAAAAAAAEAAAABIAAAAAAAAAEAAAABIAAAAAAAAAEAAAABIAAAAAAAAAEAAAABIAAAAAAAAAEAAAABIAAAAAAAAAEAAAABIAAAAAAAAAEAAAABhCUAAC5X5AAAAAABhCUAAC5X5AAAAAABgCUAAC5X5AAAAAABgCUAAC5X5AAuV+QAIAAAAAAAAAEAAAABhCUAAC5X5AAAAAABgCUAAC5X5AAuV+QAgCUAAC5X5AAbGxsAgCUAAC5X5AAuV+QAgCUAAC5X5AAuV+QAgCUAAC5X5AAuV+QAgCUAAC5X5AAuV+QAgCUAAC5X5AAbGxsAgCUAAC5X5AAuV+QAhCUAAC5X5AAAAAABIAAAAAAAAAEAAAABgCUAAC5X5AAuV+QAgCUAAC5X5AAAAAABIAAAAAAAAAEAAAABIAAAAAAAAAEAAAABgCUAAC5X5AAuV+QAgCUAAC5X5AAfO6MAgCUAAC5X5AAfO6MAgCUAAC5X5AAfO6MAgCUAAC5X5AAfO6MAgCUAAC5X5AAfO6MAgCUAAC5X5AAfO6MAgCUAAC5X5AAfO6MAgCUAAC5X5AAfO6MAgCUAAC5X5AAfO6MAgCUAAC5X5AAfO6MAgCUAAC5X5AAuV+QAIAAAAAAAAAEAAAABIAAAAAAAAAEAAAABIAAAAAAAAAEAAAABIAAAAAAAAAEAAAABIAAAAAAAAAEAAAABgCUAAC5X5AAuV+QAIAAAAAAAAAEAAAABgCUAAC5X5AAuV+QAIAAAAAAAAAEAAAABIAAAAAAAAAEAAAABIAAAAAAAAAEAAAABIAAAAAAAAAEAAAABgCUAAC5X5AAuV+QAIAAAAAAAAAEAAAABgCUAAC5X5AAuV+QAIAAAAAAAAAEAAAABIAAAAAAAAAEAAAABIAAAAAAAAAEAAAAB'
