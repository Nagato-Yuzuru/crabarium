// A character pack: parse and check `pack.json`, then compose pixels. Pure:
// the pack is data, and nothing in it runs as code.
import { own } from '../own'
import { BUILTIN_MOTIONS } from './motions'
import { CHARACTER_STATES, MAX_COLORS, packSchema } from './schema'
import { validateSchema } from './validate'
import type { SchemaError } from './validate'

export type { SchemaError }

export type Point = readonly [x: number, y: number]

/** Pixel rows of palette keys; "." is transparent. */
export type Rows = readonly string[]

export type Palette = Readonly<Record<string, string>>

/** A move in whole pixels. */
export type Move = readonly [dx: number, dy: number]

/** Other rows for the same place, by name. */
export type Variants = Readonly<Record<string, Rows>>

/** One frame of a body motion. A target is a group, a part slot, or `*` for the whole character. */
export type Frame = {
  offset?: Readonly<Record<string, Move>>
  swap?: Readonly<Record<string, string>>
  hide?: readonly string[]
  palette?: Palette
}

/** One frame of a part motion: the same operations, on the part alone. */
export type PartFrame = { offset?: Move; swap?: string; hide?: boolean; palette?: Palette }

export type Motion<F = Frame> = { fps: number; loop: boolean; frames: readonly F[] }

export type CharacterState = (typeof CHARACTER_STATES)[number]

export type Group = { at: Point; rows: Rows; variants?: Variants }

export type Part = { anchor: string; pivot: Point; rows: Rows; palette?: Palette; variants?: Variants; motion?: Motion<PartFrame> }

/** `pack.json` after it passed the schema and the checks below. */
export type Pack = {
  formatVersion: 1
  name: string
  author: string
  license: string
  attribution?: string
  notice?: string
  grid: { width: number; height: number }
  palette: Palette
  anchors?: Readonly<Record<string, Point>>
  groups: Readonly<Record<string, Group>>
  parts?: Readonly<Record<string, Readonly<Record<string, Part>>>>
  motions?: Readonly<Record<string, Motion>>
  states?: Readonly<Partial<Record<CharacterState, string>>>
  defaults?: { parts?: Readonly<Record<string, string>> }
}

export type ParseResult = { ok: true; pack: Pack } | { ok: false; errors: readonly SchemaError[] }

export const TRANSPARENT = '.'

/** The part `name` in slot `slot`, if the pack has it. */
export function partOf(pack: Pack, slot: string, name: string): Part | undefined {
  return own(own(pack.parts, slot), name)
}

function checkRows(rows: Rows, palette: Palette, path: string, errors: SchemaError[]): void {
  rows.forEach((row, y) => {
    ;[...row].forEach((key, x) => {
      if (key !== TRANSPARENT && !Object.hasOwn(palette, key)) {
        errors.push({ path: `${path}.rows[${y}]`, message: `column ${x}: ${JSON.stringify(key)} is not in the palette` })
      }
    })
  })
}

function widthOf(rows: Rows): number {
  return Math.max(...rows.map(r => [...r].length))
}

function framePaletteKeys(palette: Palette | undefined, keys: ReadonlySet<string>, path: string, errors: SchemaError[]): void {
  for (const key of Object.keys(palette ?? {})) {
    if (!keys.has(key)) errors.push({ path: `${path}.palette`, message: `${JSON.stringify(key)} is not in a palette` })
  }
}

// The rules that a JSON Schema cannot state: they relate one field to another.
function checkRelations(pack: Pack): SchemaError[] {
  const errors: SchemaError[] = []
  const { width, height } = pack.grid
  const inside = ([x, y]: Point): boolean => x < width && y < height
  const fits = (at: Point, rows: Rows, path: string): void => {
    if (at[0] + widthOf(rows) > width || at[1] + rows.length > height) {
      errors.push({ path, message: `the rows at [${at.join(', ')}] go outside the ${width} x ${height} grid` })
    }
  }
  const parts = Object.entries(pack.parts ?? {})
  const allPalettes = [pack.palette, ...parts.flatMap(([, named]) => Object.values(named).map(p => p.palette ?? {}))]
  const allKeys = new Set(allPalettes.flatMap(p => Object.keys(p)))

  for (const [name, point] of Object.entries(pack.anchors ?? {})) {
    if (!inside(point)) errors.push({ path: `anchors.${name}`, message: `[${point.join(', ')}] is outside the ${width} x ${height} grid` })
  }
  for (const [name, group] of Object.entries(pack.groups)) {
    fits(group.at, group.rows, `groups.${name}`)
    checkRows(group.rows, pack.palette, `groups.${name}`, errors)
    for (const [variant, rows] of Object.entries(group.variants ?? {})) {
      fits(group.at, rows, `groups.${name}.variants.${variant}`)
      checkRows(rows, pack.palette, `groups.${name}.variants.${variant}`, errors)
    }
  }
  for (const [slot, named] of parts) {
    // A frame names groups and slots in one list, so one name cannot be both.
    if (Object.hasOwn(pack.groups, slot)) errors.push({ path: `parts.${slot}`, message: `${JSON.stringify(slot)} is also a group name` })
    for (const [name, part] of Object.entries(named)) {
      const path = `parts.${slot}.${name}`
      const palette = { ...pack.palette, ...part.palette }
      if (!Object.hasOwn(pack.anchors ?? {}, part.anchor)) {
        errors.push({ path: `${path}.anchor`, message: `${JSON.stringify(part.anchor)} is not in anchors` })
      }
      checkRows(part.rows, palette, path, errors)
      for (const [variant, rows] of Object.entries(part.variants ?? {})) checkRows(rows, palette, `${path}.variants.${variant}`, errors)
      part.motion?.frames.forEach((frame, i) => {
        const at = `${path}.motion.frames[${i}]`
        if (frame.swap !== undefined && !Object.hasOwn(part.variants ?? {}, frame.swap)) {
          errors.push({ path: `${at}.swap`, message: `${JSON.stringify(frame.swap)} is not in ${path}.variants` })
        }
        framePaletteKeys(frame.palette, new Set(Object.keys(palette)), at, errors)
      })
    }
  }
  const targets = new Set([...Object.keys(pack.groups), ...Object.keys(pack.parts ?? {})])
  for (const [name, motion] of Object.entries(pack.motions ?? {})) {
    motion.frames.forEach((frame, i) => {
      const at = `motions.${name}.frames[${i}]`
      for (const target of Object.keys(frame.offset ?? {})) {
        if (target !== '*' && !targets.has(target))
          errors.push({ path: `${at}.offset`, message: `${JSON.stringify(target)} is not a group or a slot` })
      }
      for (const target of frame.hide ?? []) {
        if (!targets.has(target)) errors.push({ path: `${at}.hide`, message: `${JSON.stringify(target)} is not a group or a slot` })
      }
      for (const [group, variant] of Object.entries(frame.swap ?? {})) {
        if (own(own(pack.groups, group)?.variants, variant) === undefined) {
          errors.push({ path: `${at}.swap.${group}`, message: `${JSON.stringify(variant)} is not in groups.${group}.variants` })
        }
      }
      framePaletteKeys(frame.palette, allKeys, at, errors)
    })
  }
  for (const [state, motion] of Object.entries(pack.states ?? {})) {
    if (!Object.hasOwn(pack.motions ?? {}, motion) && !Object.hasOwn(BUILTIN_MOTIONS, motion)) {
      errors.push({ path: `states.${state}`, message: `${JSON.stringify(motion)} is not a motion in the pack or a built-in motion` })
    }
  }
  for (const [slot, name] of Object.entries(pack.defaults?.parts ?? {})) {
    if (partOf(pack, slot, name) === undefined) {
      errors.push({ path: `defaults.parts.${slot}`, message: `${JSON.stringify(name)} is not a part in parts.${slot}` })
    }
  }
  const framePalettes = [
    ...Object.values(pack.motions ?? {}).flatMap(m => m.frames.map(f => f.palette ?? {})),
    ...parts.flatMap(([, named]) => Object.values(named).flatMap(p => p.motion?.frames.map(f => f.palette ?? {}) ?? [])),
  ]
  const colors = new Set([...allPalettes, ...framePalettes].flatMap(p => Object.values(p).map(c => c.toLowerCase())))
  if (colors.size > MAX_COLORS) errors.push({ path: 'palette', message: `the pack uses ${colors.size} colors; the limit is ${MAX_COLORS}` })
  return errors
}

/** Checks the parsed JSON of `pack.json`. Each error names the field. */
export function parsePack(json: unknown): ParseResult {
  const errors = validateSchema(packSchema, json)
  if (errors.length > 0) return { ok: false, errors }
  const pack = json as Pack
  const relations = checkRelations(pack)
  return relations.length > 0 ? { ok: false, errors: relations } : { ok: true, pack }
}

/** Parses the text of `pack.json`. */
export function parsePackText(text: string): ParseResult {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch (error) {
    return { ok: false, errors: [{ path: '(root)', message: `is not JSON: ${(error as Error).message}` }] }
  }
  return parsePack(json)
}

/** The parts to draw: a part name for each slot. */
export type PartSelection = Readonly<Record<string, string>>

/** Colors as 0xRRGGBB, row-major; `null` is transparent. */
export type PixelGrid = { width: number; height: number; pixels: readonly (number | null)[] }

function paint(pixels: (number | null)[], grid: Pack['grid'], rows: Rows, palette: Palette, [ox, oy]: Point): void {
  rows.forEach((row, dy) => {
    ;[...row].forEach((key, dx) => {
      const x = ox + dx
      const y = oy + dy
      // A part or an offset can reach past the grid; the grid clips it.
      if (key === TRANSPARENT || x < 0 || y < 0 || x >= grid.width || y >= grid.height) return
      pixels[y * grid.width + x] = Number.parseInt(palette[key]!.slice(1), 16)
    })
  })
}

/** The frame operations to apply: one body frame, and one frame for each slot whose part moves. */
export type Pose = { body?: Frame; parts?: Readonly<Record<string, PartFrame>> }

const NO_MOVE: Move = [0, 0]

function moved([x, y]: Point, ...moves: (Move | undefined)[]): Point {
  return moves.reduce<Point>(([px, py], m = NO_MOVE) => [px + m[0], py + m[1]], [x, y])
}

/**
 * Draws the groups in their order, then one part for each selected slot, on
 * its anchor. A slot or a part that the pack does not have draws nothing. The
 * pose moves, swaps, hides, and recolors what it names.
 */
export function compose(pack: Pack, selection: PartSelection = pack.defaults?.parts ?? {}, pose: Pose = {}): PixelGrid {
  const { grid } = pack
  const { offset = {}, swap = {}, hide = [], palette: framePalette } = pose.body ?? {}
  const hidden = new Set(hide)
  const whole = own(offset, '*')
  const pixels: (number | null)[] = Array.from({ length: grid.width * grid.height }, () => null)
  for (const [name, group] of Object.entries(pack.groups)) {
    if (hidden.has(name)) continue
    const variant = own(swap, name)
    const rows = variant === undefined ? group.rows : (own(group.variants, variant) ?? group.rows)
    paint(pixels, grid, rows, { ...pack.palette, ...framePalette }, moved(group.at, whole, own(offset, name)))
  }
  for (const [slot, name] of Object.entries(selection)) {
    const part = partOf(pack, slot, name)
    const anchor = part === undefined ? undefined : own(pack.anchors, part.anchor)
    const frame = own(pose.parts, slot) ?? {}
    if (part === undefined || anchor === undefined || hidden.has(slot) || frame.hide === true) continue
    const rows = frame.swap === undefined ? part.rows : (own(part.variants, frame.swap) ?? part.rows)
    const origin = moved([anchor[0] - part.pivot[0], anchor[1] - part.pivot[1]], whole, own(offset, slot), frame.offset)
    paint(pixels, grid, rows, { ...pack.palette, ...part.palette, ...framePalette, ...frame.palette }, origin)
  }
  return { width: grid.width, height: grid.height, pixels }
}
