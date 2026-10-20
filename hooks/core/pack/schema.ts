// The JSON Schema of `pack.json`: the one source of the pack format.
// `validate` in ./validate.ts reads this object, and `pnpm gen` writes it to
// schema/pack.schema.json for editors.

/** The largest grid side, in pixels. */
export const MAX_GRID = 32
/** The largest number of different colors in one pack. */
export const MAX_COLORS = 64
/** The largest `pack.json` and `pack.css` together, in bytes. A pack is untrusted input. */
export const MAX_PACK_BYTES = 1024 * 1024
/** The most ticks that one frame holds. */
export const MAX_REPEAT = 64
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
 * The most entries in each map whose count sets the work to draw one frame:
 * groups, anchors, slots, and parts of a slot. Motions and variants have no
 * count limit: a frame draws one of them, and MAX_PACK_BYTES bounds the file.
 */
export const MAX_ENTRIES = 64
/** The channel of the root node: the whole figure. No group can have this name. */
export const FIGURE = 'figure'

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
const rows = {
  type: 'array',
  description: 'Pixel rows, top first. Each character is a palette key or "." for transparent.',
  minItems: 1,
  maxItems: MAX_GRID,
  items: { type: 'string', minLength: 1, maxLength: MAX_GRID },
} as const
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
      frames: { type: 'array', minItems: 1, items: { $ref: frame } },
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
      $ref: '#/$defs/anchors',
      description:
        'The anchors of the root (the whole figure): points on the grid where groups and parts attach, for example head. An anchor name is unique in the pack.',
    },
    figure: {
      type: 'object',
      description: `The root node as a channel, "${FIGURE}". Its variants are whole-figure drawings; a variant with covers draws in place of the groups.`,
      additionalProperties: false,
      properties: { variants: { $ref: '#/$defs/variants' } },
    },
    groups: {
      type: 'object',
      description:
        'The body, in groups that a motion can move, swap, or hide. A group is at a point of the grid, or on an anchor of another group, which is then its parent; moving or hiding a group moves or hides the groups on it. The groups are drawn in this order.',
      minProperties: 1,
      maxProperties: MAX_ENTRIES,
      propertyNames: { ...name, not: { const: FIGURE } },
      additionalProperties: {
        type: 'object',
        required: ['rows'],
        additionalProperties: false,
        properties: {
          at: { ...point, description: 'Where the group is on the grid. A group has at, or anchor and pivot.' },
          anchor: { ...name, description: 'The anchor of another group that the pivot goes to.' },
          pivot: { ...point, description: 'The point of the group, from its top left, that goes on the anchor.' },
          anchors: {
            $ref: '#/$defs/anchors',
            description: 'Anchors on this group, from its top left. An anchor name is unique in the pack.',
          },
          rows: { $ref: '#/$defs/rows' },
          variants: { $ref: '#/$defs/variants' },
        },
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
    rows,
    anchors: {
      type: 'object',
      maxProperties: MAX_ENTRIES,
      propertyNames: name,
      additionalProperties: point,
    },
    variants: {
      type: 'object',
      description: `Other drawings of the same node, by name; "base" is the node's own rows. A frame swap or a pack.css channel value selects one.`,
      propertyNames: { ...name, not: { const: 'base' } },
      additionalProperties: {
        anyOf: [
          rows,
          {
            type: 'object',
            required: ['rows'],
            additionalProperties: false,
            properties: {
              rows,
              anchors: {
                $ref: '#/$defs/anchors',
                description:
                  'Where the anchors of the node are in this drawing, from its top left. With covers, it can also place the anchors of the groups that it covers.',
              },
              covers: { type: 'boolean', description: 'true: the drawing includes the groups on this node, so they are not drawn.' },
            },
          },
        ],
      },
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
          description: `Draws a group, a part slot, or "${FIGURE}" with one of its variants, or "base".`,
          propertyNames: name,
          additionalProperties: name,
        },
        hide: { type: 'array', description: 'Groups and slots that this frame does not draw.', items: name },
        palette: { $ref: '#/$defs/palette', description: 'Colors that replace palette colors for this frame, in each palette.' },
        repeat: { type: 'integer', minimum: 1, maximum: MAX_REPEAT, description: 'How many ticks this frame holds. The default is 1.' },
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
        repeat: { type: 'integer', minimum: 1, maximum: MAX_REPEAT, description: 'How many ticks this frame holds. The default is 1.' },
      },
    },
  },
} as const
