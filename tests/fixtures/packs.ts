// Pack fixtures, shared by the engine tests and by `pnpm gen --check`, which
// runs each fixture through Ajv. So the published JSON Schema and the mod's own
// validator must give the same answer for each fixture. This file has no
// imports, so that the generator can load it without the engine.

export type PackFixture = {
  name: string
  json: unknown
  /** The JSON Schema accepts it. */
  schemaValid: boolean
  /** The mod accepts it: the schema and the relations between fields. */
  packValid: boolean
}

export const validPack = {
  formatVersion: 1,
  name: 'tiny',
  author: 'test',
  license: 'MIT',
  grid: { width: 4, height: 3 },
  palette: { a: '#ff0000', b: '#00ff00' },
  anchors: { head: [2, 0] },
  groups: {
    body: { at: [0, 1], rows: ['aaaa', 'a..a'] },
  },
  parts: {
    hat: { dot: { anchor: 'head', pivot: [0, 0], rows: ['c'], palette: { c: '#0000ff' } } },
  },
  defaults: { parts: { hat: 'dot' } },
}

function edit(change: (pack: Record<string, any>) => void): unknown {
  const pack = structuredClone(validPack) as Record<string, any>
  change(pack)
  return pack
}

const largestPalette = Object.fromEntries(
  Array.from({ length: 64 }, (_, i) => [String.fromCodePoint(0x30 + i), `#0000${i.toString(16).padStart(2, '0')}`]),
)

export const packFixtures: readonly PackFixture[] = [
  { name: 'a valid pack', json: validPack, schemaValid: true, packValid: true },
  {
    name: 'a pack with only the required fields',
    json: edit(p => {
      delete p.anchors
      delete p.parts
      delete p.defaults
    }),
    schemaValid: true,
    packValid: true,
  },
  {
    name: 'a 32 x 32 grid',
    json: edit(p => {
      p.grid = { width: 32, height: 32 }
    }),
    schemaValid: true,
    packValid: true,
  },
  {
    name: 'a 33-pixel-wide grid',
    json: edit(p => {
      p.grid.width = 33
    }),
    schemaValid: false,
    packValid: false,
  },
  {
    name: 'a grid with no height',
    json: edit(p => {
      delete p.grid.height
    }),
    schemaValid: false,
    packValid: false,
  },
  {
    name: 'a format version that is not 1',
    json: edit(p => {
      p.formatVersion = 2
    }),
    schemaValid: false,
    packValid: false,
  },
  {
    name: 'an unknown top-level field',
    json: edit(p => {
      p.script = 'run()'
    }),
    schemaValid: false,
    packValid: false,
  },
  {
    name: 'a name with a space',
    json: edit(p => {
      p.name = 'my pack'
    }),
    schemaValid: false,
    packValid: false,
  },
  {
    name: 'a 3-digit color',
    json: edit(p => {
      p.palette.a = '#f00'
    }),
    schemaValid: false,
    packValid: false,
  },
  {
    name: '"." as a palette key',
    json: edit(p => {
      p.palette['.'] = '#000000'
    }),
    schemaValid: false,
    packValid: false,
  },
  {
    name: 'a 2-character palette key',
    json: edit(p => {
      p.palette.ab = '#000000'
    }),
    schemaValid: false,
    packValid: false,
  },
  {
    name: '64 colors in the palette',
    json: edit(p => {
      p.palette = largestPalette
      delete p.parts
      delete p.defaults
      p.groups.body.rows = ['0000']
    }),
    schemaValid: true,
    packValid: true,
  },
  {
    name: '65 colors in the palette',
    json: edit(p => {
      p.palette = { ...largestPalette, z: '#ffffff' }
      p.groups.body.rows = ['0000']
    }),
    schemaValid: false,
    packValid: false,
  },
  {
    name: '65 colors over the palette and a part',
    json: edit(p => {
      p.palette = largestPalette
      p.groups.body.rows = ['0000']
    }),
    schemaValid: true,
    packValid: false,
  },
  {
    name: 'a row of 33 pixels',
    json: edit(p => {
      p.groups.body.rows = ['a'.repeat(33)]
    }),
    schemaValid: false,
    packValid: false,
  },
  {
    name: 'no groups',
    json: edit(p => {
      p.groups = {}
    }),
    schemaValid: false,
    packValid: false,
  },
  {
    name: 'an anchor with one coordinate',
    json: edit(p => {
      p.anchors.head = [2]
    }),
    schemaValid: false,
    packValid: false,
  },
  {
    name: 'a negative coordinate',
    json: edit(p => {
      p.groups.body.at = [-1, 0]
    }),
    schemaValid: false,
    packValid: false,
  },
  {
    name: 'a fractional coordinate',
    json: edit(p => {
      p.groups.body.at = [0.5, 0]
    }),
    schemaValid: false,
    packValid: false,
  },
  {
    name: 'a pixel key that is not in the palette',
    json: edit(p => {
      p.groups.body.rows = ['aaxa']
    }),
    schemaValid: true,
    packValid: false,
  },
  {
    name: 'a group that goes outside the grid',
    json: edit(p => {
      p.groups.body.at = [1, 1]
    }),
    schemaValid: true,
    packValid: false,
  },
  {
    name: 'an anchor outside the grid',
    json: edit(p => {
      p.anchors.head = [4, 0]
    }),
    schemaValid: true,
    packValid: false,
  },
  {
    name: 'a part on an anchor that does not exist',
    json: edit(p => {
      p.parts.hat.dot.anchor = 'tail'
    }),
    schemaValid: true,
    packValid: false,
  },
  {
    name: 'a default part that does not exist',
    json: edit(p => {
      p.defaults.parts.hat = 'crown'
    }),
    schemaValid: true,
    packValid: false,
  },
  {
    name: 'motions with each frame operation, a part motion, and states',
    json: edit(p => {
      p.groups.body.variants = { flat: ['aaaa'] }
      p.parts.hat.dot.variants = { big: ['cc'] }
      p.parts.hat.dot.motion = {
        fps: 2,
        loop: true,
        frames: [
          { offset: [0, -1], swap: 'big' },
          { hide: true, palette: { c: '#ffffff' } },
        ],
      }
      p.motions = {
        wave: {
          fps: 30,
          loop: false,
          frames: [{ offset: { '*': [0, -1], hat: [1, 0] }, swap: { body: 'flat' }, hide: ['hat'], palette: { a: '#000000' } }, {}],
        },
      }
      p.states = { working: 'wave', idle: 'bob' }
    }),
    schemaValid: true,
    packValid: true,
  },
  {
    name: 'a motion with 32 frames',
    json: edit(p => {
      p.motions = { long: { fps: 1, loop: true, frames: Array.from({ length: 32 }, () => ({})) } }
    }),
    schemaValid: true,
    packValid: true,
  },
  {
    name: 'a motion with 33 frames',
    json: edit(p => {
      p.motions = { long: { fps: 1, loop: true, frames: Array.from({ length: 33 }, () => ({})) } }
    }),
    schemaValid: false,
    packValid: false,
  },
  {
    name: 'a motion at 31 fps',
    json: edit(p => {
      p.motions = { fast: { fps: 31, loop: true, frames: [{}] } }
    }),
    schemaValid: false,
    packValid: false,
  },
  {
    name: 'a frame operation that is not one of the four',
    json: edit(p => {
      p.motions = { spin: { fps: 1, loop: true, frames: [{ rotate: 90 }] } }
    }),
    schemaValid: false,
    packValid: false,
  },
  {
    name: '"*" in hide',
    json: edit(p => {
      p.motions = { gone: { fps: 1, loop: true, frames: [{ hide: ['*'] }] } }
    }),
    schemaValid: false,
    packValid: false,
  },
  {
    name: 'a state that is not a character state',
    json: edit(p => {
      p.states = { dancing: 'bob' }
    }),
    schemaValid: false,
    packValid: false,
  },
  {
    name: 'an offset of a target that does not exist',
    json: edit(p => {
      p.motions = { m: { fps: 1, loop: true, frames: [{ offset: { tail: [0, 1] } }] } }
    }),
    schemaValid: true,
    packValid: false,
  },
  {
    name: 'a swap to a variant that does not exist',
    json: edit(p => {
      p.motions = { m: { fps: 1, loop: true, frames: [{ swap: { body: 'flat' } }] } }
    }),
    schemaValid: true,
    packValid: false,
  },
  {
    name: 'a state with a motion that does not exist',
    json: edit(p => {
      p.states = { idle: 'dance' }
    }),
    schemaValid: true,
    packValid: false,
  },
  {
    name: 'a slot with the name of a group',
    json: edit(p => {
      p.parts.body = p.parts.hat
    }),
    schemaValid: true,
    packValid: false,
  },
]
