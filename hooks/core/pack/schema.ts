// The JSON Schema of `pack.json`: the one source of the pack format.
// `validate` in ./validate.ts reads this object, and `pnpm gen` writes it to
// schema/pack.schema.json for editors. This file has no imports, so that the
// generator can load it without the engine.

/** The largest grid side, in pixels. */
export const MAX_GRID = 32
/** The largest number of different colors in one pack. */
export const MAX_COLORS = 64
/** The most frames in one motion. */
export const MAX_FRAMES = 32
/** The highest frame rate of a motion. */
export const MAX_FPS = 30
/** The character states that `states` can give a motion. */
export const CHARACTER_STATES = ['entering', 'working', 'idle', 'finished', 'failed', 'leaving'] as const
/**
 * The roles that the selector gives an agent. It is a closed set: a
 * classifier answers one choice over it, and each pack maps the roles that it
 * has art for.
 */
export const ROLES = ['explorer', 'reviewer', 'builder', 'tester', 'planner', 'researcher'] as const
/** The highest weight of an outfit. */
export const MAX_WEIGHT = 100
/**
 * The most entries in one map of a pack (groups, anchors, slots, parts of a
 * slot, variants, motions). A pack is untrusted input, and the work to draw a
 * frame grows with these counts.
 */
export const MAX_ENTRIES = 64

const coordinate = { type: 'integer', minimum: 0, maximum: MAX_GRID - 1 } as const
const point = {
  type: 'array',
  prefixItems: [coordinate, coordinate],
  minItems: 2,
  maxItems: 2,
  description: '[x, y] in pixels from the top left.',
} as const
const delta = { type: 'integer', minimum: -MAX_GRID, maximum: MAX_GRID } as const
const move = {
  type: 'array',
  prefixItems: [delta, delta],
  minItems: 2,
  maxItems: 2,
  description: '[dx, dy] in whole pixels.',
} as const
const NAME = '[a-zA-Z][a-zA-Z0-9-]{0,31}'
const name = { type: 'string', pattern: `^${NAME}$` } as const
const color = { type: 'string', pattern: '^#[0-9a-fA-F]{6}$', description: 'A color as #rrggbb.' } as const

function motion(frame: '#/$defs/frame' | '#/$defs/partFrame') {
  return {
    type: 'object',
    required: ['fps', 'loop', 'frames'],
    additionalProperties: false,
    properties: {
      fps: { type: 'integer', minimum: 1, maximum: MAX_FPS },
      loop: { type: 'boolean', description: 'true plays the frames again; false holds the last frame.' },
      frames: { type: 'array', minItems: 1, maxItems: MAX_FRAMES, items: { $ref: frame } },
    },
  } as const
}

export const packSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://github.com/Nagato-Yuzuru/crabarium/blob/main/schema/pack.schema.json',
  title: 'crabarium character pack',
  type: 'object',
  required: ['formatVersion', 'name', 'author', 'license', 'grid', 'palette', 'groups'],
  additionalProperties: false,
  properties: {
    $schema: { type: 'string' },
    formatVersion: { const: 1, description: 'The pack format version. This schema is version 1.' },
    name: { ...name, description: 'The pack name that `/crabarium pack <name>` selects.' },
    author: { type: 'string', minLength: 1, maxLength: 200 },
    license: { type: 'string', minLength: 1, maxLength: 100, description: 'An SPDX license expression, for example MIT.' },
    attribution: { type: 'string', maxLength: 1000, description: 'Where the art comes from.' },
    notice: { type: 'string', maxLength: 1000, description: 'A notice that the README and the pack list show.' },
    grid: {
      type: 'object',
      required: ['width', 'height'],
      additionalProperties: false,
      properties: {
        width: { type: 'integer', minimum: 1, maximum: MAX_GRID },
        height: { type: 'integer', minimum: 1, maximum: MAX_GRID },
      },
    },
    palette: { $ref: '#/$defs/palette' },
    anchors: {
      type: 'object',
      description: 'Named points where parts attach, for example head.',
      maxProperties: MAX_ENTRIES,
      propertyNames: name,
      additionalProperties: point,
    },
    groups: {
      type: 'object',
      description: 'The body, in groups that a motion can move or hide. The groups are drawn in this order.',
      minProperties: 1,
      maxProperties: MAX_ENTRIES,
      propertyNames: name,
      additionalProperties: {
        type: 'object',
        required: ['at', 'rows'],
        additionalProperties: false,
        properties: { at: point, rows: { $ref: '#/$defs/rows' }, variants: { $ref: '#/$defs/variants' } },
      },
    },
    parts: {
      type: 'object',
      description: 'Parts by slot (hat, held, back), then by name. They are drawn after the groups.',
      maxProperties: MAX_ENTRIES,
      propertyNames: name,
      additionalProperties: {
        type: 'object',
        maxProperties: MAX_ENTRIES,
        propertyNames: name,
        additionalProperties: {
          type: 'object',
          required: ['anchor', 'pivot', 'rows'],
          additionalProperties: false,
          properties: {
            anchor: { ...name, description: 'The anchor that the pivot goes to.' },
            pivot: { ...point, description: 'The point of the part, from its top left, that goes on the anchor.' },
            rows: { $ref: '#/$defs/rows' },
            palette: { $ref: '#/$defs/palette' },
            variants: { $ref: '#/$defs/variants' },
            motion: {
              ...motion('#/$defs/partFrame'),
              description: 'The motion of the part itself. It names nothing outside the part, so it is the same on each body.',
            },
          },
        },
      },
    },
    motions: {
      type: 'object',
      description: 'Motions by name. A motion with the name of a built-in motion (walk, bob, float, swing) replaces it.',
      maxProperties: MAX_ENTRIES,
      propertyNames: name,
      additionalProperties: motion('#/$defs/frame'),
    },
    states: {
      type: 'object',
      description: 'The motion for each character state. A state with no motion shows the still character.',
      additionalProperties: false,
      properties: Object.fromEntries(CHARACTER_STATES.map(state => [state, name])),
    },
    roles: {
      type: 'object',
      description: `The outfits of each role. The roles are ${ROLES.join(', ')}. An agent of a role gets one of its outfits, picked by weight; the same agent always gets the same one.`,
      propertyNames: { type: 'string', pattern: `^(${ROLES.join('|')})$` },
      additionalProperties: {
        type: 'array',
        minItems: 1,
        maxItems: 16,
        items: { $ref: '#/$defs/outfit' },
      },
    },
    defaults: {
      type: 'object',
      additionalProperties: false,
      properties: {
        parts: {
          type: 'object',
          description: 'The part that each slot shows when no rule selects one.',
          propertyNames: name,
          additionalProperties: name,
        },
      },
    },
  },
  $defs: {
    outfit: {
      type: 'object',
      required: ['parts'],
      additionalProperties: false,
      properties: {
        parts: { $ref: '#/$defs/selection' },
        weight: {
          type: 'integer',
          minimum: 1,
          maximum: MAX_WEIGHT,
          description: 'How often this outfit is picked, against the others of the role. The default is 1.',
        },
      },
    },
    selection: {
      type: 'object',
      description: 'A part name for each slot.',
      maxProperties: MAX_ENTRIES,
      propertyNames: name,
      additionalProperties: name,
    },
    palette: {
      type: 'object',
      description: 'One character for each color. "." is transparent and cannot be a key.',
      propertyNames: { type: 'string', pattern: '^[!-~]$', not: { const: '.' } },
      additionalProperties: color,
      maxProperties: MAX_COLORS,
    },
    rows: {
      type: 'array',
      description: 'Pixel rows, top first. Each character is a palette key or "." for transparent.',
      minItems: 1,
      maxItems: MAX_GRID,
      items: { type: 'string', minLength: 1, maxLength: MAX_GRID },
    },
    variants: {
      type: 'object',
      description: 'Other rows for the same place, by name. A frame `swap` draws one of them.',
      maxProperties: MAX_ENTRIES,
      propertyNames: name,
      additionalProperties: { $ref: '#/$defs/rows' },
    },
    frame: {
      type: 'object',
      description: 'One frame of a body motion. A target is a group, a part slot, or "*" for the whole character.',
      additionalProperties: false,
      properties: {
        offset: {
          type: 'object',
          description: 'Moves targets. The offsets of "*" and of a target add together.',
          propertyNames: { type: 'string', pattern: `^(\\*|${NAME})$` },
          additionalProperties: move,
        },
        swap: {
          type: 'object',
          description: 'Draws a group with one of its variants.',
          propertyNames: name,
          additionalProperties: name,
        },
        hide: { type: 'array', description: 'Groups and slots that this frame does not draw.', items: name },
        palette: { $ref: '#/$defs/palette', description: 'Colors that replace palette colors for this frame, in each palette.' },
      },
    },
    partFrame: {
      type: 'object',
      description: 'One frame of a part motion.',
      additionalProperties: false,
      properties: {
        offset: move,
        swap: { ...name, description: 'Draws the part with one of its variants.' },
        hide: { type: 'boolean' },
        palette: { $ref: '#/$defs/palette', description: 'Colors that replace palette colors for this frame.' },
      },
    },
  },
} as const
