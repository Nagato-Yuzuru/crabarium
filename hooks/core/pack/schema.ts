// The JSON Schema of `pack.json`: the one source of the pack format.
// `validate` in ./validate.ts reads this object, and `pnpm gen` writes it to
// schema/pack.schema.json for editors. This file has no imports, so that the
// generator can load it without the engine.

/** The largest grid side, in pixels. */
export const MAX_GRID = 32
/** The largest number of different colors in one pack. */
export const MAX_COLORS = 64

const coordinate = { type: 'integer', minimum: 0, maximum: MAX_GRID - 1 } as const
const point = {
  type: 'array',
  prefixItems: [coordinate, coordinate],
  minItems: 2,
  maxItems: 2,
  description: '[x, y] in pixels from the top left.',
} as const
const name = { type: 'string', pattern: '^[a-zA-Z][a-zA-Z0-9-]{0,31}$' } as const
const color = { type: 'string', pattern: '^#[0-9a-fA-F]{6}$', description: 'A color as #rrggbb.' } as const

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
      propertyNames: name,
      additionalProperties: point,
    },
    groups: {
      type: 'object',
      description: 'The body, in groups that a motion can move or hide. The groups are drawn in this order.',
      minProperties: 1,
      propertyNames: name,
      additionalProperties: {
        type: 'object',
        required: ['at', 'rows'],
        additionalProperties: false,
        properties: { at: point, rows: { $ref: '#/$defs/rows' } },
      },
    },
    parts: {
      type: 'object',
      description: 'Parts by slot (hat, held, back), then by name. They are drawn after the groups.',
      propertyNames: name,
      additionalProperties: {
        type: 'object',
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
          },
        },
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
  },
} as const
