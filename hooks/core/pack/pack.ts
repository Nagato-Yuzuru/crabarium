// A character pack: parse and check `pack.json`, then compose pixels. Pure:
// the pack is data, and nothing in it runs as code.
import { MAX_COLORS, packSchema } from './schema'
import { validateSchema } from './validate'
import type { SchemaError } from './validate'

export type { SchemaError }

export type Point = readonly [x: number, y: number]

/** Pixel rows of palette keys; "." is transparent. */
export type Rows = readonly string[]

export type Palette = Readonly<Record<string, string>>

export type Group = { at: Point; rows: Rows }

export type Part = { anchor: string; pivot: Point; rows: Rows; palette?: Palette }

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
  defaults?: { parts?: Readonly<Record<string, string>> }
}

export type ParseResult = { ok: true; pack: Pack } | { ok: false; errors: readonly SchemaError[] }

export const TRANSPARENT = '.'

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

// The rules that a JSON Schema cannot state: they relate one field to another.
function checkRelations(pack: Pack): SchemaError[] {
  const errors: SchemaError[] = []
  const { width, height } = pack.grid
  const inside = ([x, y]: Point): boolean => x < width && y < height

  for (const [name, point] of Object.entries(pack.anchors ?? {})) {
    if (!inside(point)) errors.push({ path: `anchors.${name}`, message: `[${point.join(', ')}] is outside the ${width} x ${height} grid` })
  }
  for (const [name, group] of Object.entries(pack.groups)) {
    const [x, y] = group.at
    if (x + widthOf(group.rows) > width || y + group.rows.length > height) {
      errors.push({ path: `groups.${name}`, message: `the rows at [${x}, ${y}] go outside the ${width} x ${height} grid` })
    }
    checkRows(group.rows, pack.palette, `groups.${name}`, errors)
  }
  for (const [slot, parts] of Object.entries(pack.parts ?? {})) {
    for (const [name, part] of Object.entries(parts)) {
      const path = `parts.${slot}.${name}`
      if (!Object.hasOwn(pack.anchors ?? {}, part.anchor)) {
        errors.push({ path: `${path}.anchor`, message: `${JSON.stringify(part.anchor)} is not in anchors` })
      }
      checkRows(part.rows, { ...pack.palette, ...part.palette }, path, errors)
    }
  }
  for (const [slot, name] of Object.entries(pack.defaults?.parts ?? {})) {
    if (pack.parts?.[slot]?.[name] === undefined) {
      errors.push({ path: `defaults.parts.${slot}`, message: `${JSON.stringify(name)} is not a part in parts.${slot}` })
    }
  }
  const colors = new Set(
    [pack.palette, ...Object.values(pack.parts ?? {}).flatMap(parts => Object.values(parts).map(p => p.palette ?? {}))].flatMap(p =>
      Object.values(p).map(c => c.toLowerCase()),
    ),
  )
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
      // A part can reach past the grid on a small body; the grid clips it.
      if (key === TRANSPARENT || x < 0 || y < 0 || x >= grid.width || y >= grid.height) return
      pixels[y * grid.width + x] = Number.parseInt(palette[key]!.slice(1), 16)
    })
  })
}

/**
 * Draws the groups in their order, then one part for each selected slot, on
 * its anchor. A slot or a part that the pack does not have draws nothing.
 */
export function compose(pack: Pack, selection: PartSelection = pack.defaults?.parts ?? {}): PixelGrid {
  const { grid } = pack
  const pixels: (number | null)[] = Array.from({ length: grid.width * grid.height }, () => null)
  for (const group of Object.values(pack.groups)) paint(pixels, grid, group.rows, pack.palette, group.at)
  for (const [slot, name] of Object.entries(selection)) {
    const part = pack.parts?.[slot]?.[name]
    const anchor = part === undefined ? undefined : pack.anchors?.[part.anchor]
    if (part === undefined || anchor === undefined) continue
    const origin: Point = [anchor[0] - part.pivot[0], anchor[1] - part.pivot[1]]
    paint(pixels, grid, part.rows, { ...pack.palette, ...part.palette }, origin)
  }
  return { width: grid.width, height: grid.height, pixels }
}
