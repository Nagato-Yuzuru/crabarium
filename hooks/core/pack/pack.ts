// A character pack: parse and check `pack.json`, then compose pixels. Pure:
// the pack is data, and nothing in it runs as code.
import { own } from '../own.ts'
import { BUILTIN_MOTIONS } from './motions.ts'
import { CHARACTER_STATES, FIGURE, MAX_COLORS, packSchema, ROLES } from './schema.ts'
import { validateSchema } from './validate.ts'
import type { SchemaError } from './validate.ts'

export type { SchemaError }

export type Point = readonly [x: number, y: number]

/** Pixel rows of palette keys; "." is transparent. */
export type Rows = readonly string[]

export type Palette = Readonly<Record<string, string>>

/** A move in whole pixels. */
export type Move = readonly [dx: number, dy: number]

/** Anchors by name, from the top left of their node (the grid, for the root). */
export type Anchors = Readonly<Record<string, Point>>

/** Another drawing of a node: rows, or rows with the node's anchors in this drawing and whether it covers the groups on the node. */
export type Variant = Rows | { rows: Rows; anchors?: Anchors; covers?: boolean }

/** Other drawings of the same node, by name. */
export type Variants = Readonly<Record<string, Variant>>

/** One frame of a body motion. A target is a group, a part slot, `*` for the whole character, or (in swap) `figure`. */
export type Frame = {
  offset?: Readonly<Record<string, Move>>
  swap?: Readonly<Record<string, string>>
  hide?: readonly string[]
  palette?: Palette
  repeat?: number
}

/** One frame of a part motion: the same operations, on the part alone. */
export type PartFrame = { offset?: Move; swap?: string; hide?: boolean; palette?: Palette; repeat?: number }

export type Motion<F = Frame> = { fps: number; loop: boolean; frames: readonly F[] }

export type CharacterState = (typeof CHARACTER_STATES)[number]

export type Role = (typeof ROLES)[number]

/** A part set that a role can wear, and how often it is picked against the others of the role. */
export type Outfit = { parts: Readonly<Record<string, string>>; weight?: number }

/** A body node: at a point of the grid, or with its pivot on an anchor of another group (its parent). */
export type Group = { at?: Point; anchor?: string; pivot?: Point; anchors?: Anchors; rows: Rows; variants?: Variants }

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
  anchors?: Anchors
  figure?: { variants?: Variants }
  groups: Readonly<Record<string, Group>>
  parts?: Readonly<Record<string, Readonly<Record<string, Part>>>>
  motions?: Readonly<Record<string, Motion>>
  states?: Readonly<Partial<Record<CharacterState, string>>>
  roles?: Readonly<Partial<Record<Role, readonly Outfit[]>>>
  defaults?: { parts?: Readonly<Record<string, string>> }
}

export type ParseResult = { ok: true; pack: Pack } | { ok: false; errors: readonly SchemaError[] }

export const TRANSPARENT = '.'

/** The channel value that draws a node's own rows. */
export const BASE = 'base'

// Array.isArray does not narrow a readonly array out of a union.
function isRows(variant: Variant): variant is Rows {
  return Array.isArray(variant)
}

export function variantRows(variant: Variant): Rows {
  return isRows(variant) ? variant : variant.rows
}

function variantAnchors(variant: Variant | undefined): Anchors | undefined {
  return variant === undefined || isRows(variant) ? undefined : variant.anchors
}

function covers(variant: Variant | undefined): boolean {
  return variant !== undefined && !isRows(variant) && variant.covers === true
}

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

/**
 * The tree of a pack: the parent of each group (`figure` is the root) and the
 * node that owns each anchor. Anchor names are unique, so an anchor names its
 * node. `null` parent: the group is on an anchor that no node has.
 */
export type Tree = { parent: ReadonlyMap<string, string | null>; owner: ReadonlyMap<string, string> }

const trees = new WeakMap<Pack, Tree>()

export function treeOf(pack: Pack): Tree {
  let tree = trees.get(pack)
  if (tree === undefined) {
    const owner = new Map<string, string>()
    for (const name of Object.keys(pack.anchors ?? {})) owner.set(name, FIGURE)
    for (const [group, { anchors }] of Object.entries(pack.groups)) {
      for (const name of Object.keys(anchors ?? {})) if (!owner.has(name)) owner.set(name, group)
    }
    const parent = new Map<string, string | null>()
    for (const [name, group] of Object.entries(pack.groups)) {
      parent.set(name, group.anchor === undefined ? FIGURE : (owner.get(group.anchor) ?? null))
    }
    tree = { parent, owner }
    trees.set(pack, tree)
  }
  return tree
}

/** The node and the nodes above it, nearest first, up to the root; it stops at a cycle. */
export function lineage(tree: Tree, node: string): readonly string[] {
  const chain: string[] = []
  for (let at: string | null | undefined = node; at !== undefined && at !== null && !chain.includes(at); at = tree.parent.get(at)) {
    chain.push(at)
    if (at === FIGURE) break
  }
  return chain
}

/** A node's variants: `figure` or a group. */
function variantsOf(pack: Pack, node: string): Variants | undefined {
  return node === FIGURE ? pack.figure?.variants : own(pack.groups, node)?.variants
}

/** Whether `value` is a value of the channel: `base`, or a variant of the node, or of a part in the slot. */
export function isChannelValue(pack: Pack, channel: string, value: string): boolean {
  if (value === BASE) return true
  if (Object.hasOwn(pack.parts ?? {}, channel))
    return Object.values(own(pack.parts, channel) ?? {}).some(p => own(p.variants, value) !== undefined)
  return own(variantsOf(pack, channel), value) !== undefined
}

/** The tree node of a channel: a group or the root is itself; a slot is the node that holds its part's anchor. */
function nodeOf(pack: Pack, tree: Tree, channel: string, parts: PartSelection): string | undefined {
  if (!Object.hasOwn(pack.parts ?? {}, channel)) return channel
  const name = own(parts, channel)
  const part = name === undefined ? undefined : partOf(pack, channel, name)
  return part === undefined ? undefined : tree.owner.get(part.anchor)
}

/** Whether a node is `channel` or under it; for a slot, whether its part hangs on `channel` or under it. */
export function isUnder(pack: Pack, node: string, channel: string, parts: PartSelection): boolean {
  const tree = treeOf(pack)
  const at = nodeOf(pack, tree, node, parts)
  return at !== undefined && lineage(tree, at).includes(channel)
}

/** Whether `channel` at `value` is a drawing that covers one of `locked` (groups or slots). */
export function coversAny(pack: Pack, channel: string, value: string, locked: ReadonlySet<string>, parts: PartSelection): boolean {
  if (locked.size === 0 || !covers(own(variantsOf(pack, channel), value))) return false
  return [...locked].some(node => node !== channel && isUnder(pack, node, channel, parts))
}

/** The channels of a pack: the root, each group, and each part slot. */
export function isChannel(pack: Pack, name: string): boolean {
  return name === FIGURE || Object.hasOwn(pack.groups, name) || Object.hasOwn(pack.parts ?? {}, name)
}

function checkVariants(
  pack: Pack,
  tree: Tree,
  node: string,
  variants: Variants | undefined,
  palette: Palette,
  path: string,
  errors: SchemaError[],
): void {
  for (const [name, variant] of Object.entries(variants ?? {})) {
    const at = `${path}.variants.${name}`
    checkRows(variantRows(variant), palette, at, errors)
    for (const anchor of Object.keys(variantAnchors(variant) ?? {})) {
      const holder = tree.owner.get(anchor)
      // A drawing places its own anchors; one that covers can also place the anchors of the groups under it.
      const fits = holder === node || (covers(variant) && holder !== undefined && lineage(tree, holder).includes(node))
      if (!fits) {
        errors.push({
          path: `${at}.anchors.${anchor}`,
          message: covers(variant)
            ? `${JSON.stringify(anchor)} is not an anchor of ${node} or of a group under it`
            : `${JSON.stringify(anchor)} is not an anchor of ${node}; only a variant with covers can place the anchors of the groups under it`,
        })
      }
    }
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
  const tree = treeOf(pack)

  for (const [name, point] of Object.entries(pack.anchors ?? {})) {
    if (!inside(point)) errors.push({ path: `anchors.${name}`, message: `[${point.join(', ')}] is outside the ${width} x ${height} grid` })
  }
  checkVariants(pack, tree, FIGURE, pack.figure?.variants, pack.palette, FIGURE, errors)
  for (const [variant, drawn] of Object.entries(pack.figure?.variants ?? {}))
    fits([0, 0], variantRows(drawn), `${FIGURE}.variants.${variant}`)
  for (const [name, group] of Object.entries(pack.groups)) {
    const path = `groups.${name}`
    for (const anchor of Object.keys(group.anchors ?? {})) {
      const holder = tree.owner.get(anchor)
      if (holder !== name) {
        errors.push({
          path: `${path}.anchors.${anchor}`,
          message: `${JSON.stringify(anchor)} is also an anchor of ${holder}; anchor names are unique`,
        })
      }
    }
    if (group.anchor === undefined) {
      if (group.at === undefined) errors.push({ path, message: 'needs at, or anchor and pivot' })
      if (group.pivot !== undefined) errors.push({ path: `${path}.pivot`, message: 'goes with anchor; a group at a point has no pivot' })
      if (group.at !== undefined) {
        fits(group.at, group.rows, path)
        for (const [variant, drawn] of Object.entries(group.variants ?? {}))
          fits(group.at, variantRows(drawn), `${path}.variants.${variant}`)
      }
    } else {
      if (group.at !== undefined) errors.push({ path: `${path}.at`, message: 'a group is at a point, or on an anchor; not both' })
      if (group.pivot === undefined) errors.push({ path, message: 'needs a pivot, the point that goes on its anchor' })
      if (!tree.owner.has(group.anchor)) {
        errors.push({ path: `${path}.anchor`, message: `${JSON.stringify(group.anchor)} is not an anchor` })
      } else if (lineage(tree, name).at(-1) !== FIGURE) {
        errors.push({
          path: `${path}.anchor`,
          message: `${JSON.stringify(group.anchor)} is on ${name} or on a group under it, so the groups form a loop`,
        })
      }
    }
    checkRows(group.rows, pack.palette, path, errors)
    checkVariants(pack, tree, name, group.variants, pack.palette, path, errors)
  }
  for (const [slot, named] of parts) {
    // A frame names groups and slots in one list, so one name cannot be both.
    if (Object.hasOwn(pack.groups, slot)) errors.push({ path: `parts.${slot}`, message: `${JSON.stringify(slot)} is also a group name` })
    if (slot === FIGURE) errors.push({ path: `parts.${slot}`, message: `${JSON.stringify(FIGURE)} is the root, not a slot` })
    for (const [name, part] of Object.entries(named)) {
      const path = `parts.${slot}.${name}`
      const palette = { ...pack.palette, ...part.palette }
      if (!tree.owner.has(part.anchor)) {
        errors.push({ path: `${path}.anchor`, message: `${JSON.stringify(part.anchor)} is not an anchor` })
      }
      checkRows(part.rows, palette, path, errors)
      for (const [variant, drawn] of Object.entries(part.variants ?? {})) {
        checkRows(variantRows(drawn), palette, `${path}.variants.${variant}`, errors)
        // A part is a leaf: nothing hangs on it, so it has no anchors to place and nothing to cover.
        if (!isRows(drawn) && (drawn.anchors !== undefined || drawn.covers !== undefined)) {
          errors.push({
            path: `${path}.variants.${variant}`,
            message: 'a part variant is rows only: a part has no anchors and covers nothing',
          })
        }
      }
      part.motion?.frames.forEach((frame, i) => {
        const at = `${path}.motion.frames[${i}]`
        if (frame.swap !== undefined && frame.swap !== BASE && !Object.hasOwn(part.variants ?? {}, frame.swap)) {
          errors.push({ path: `${at}.swap`, message: `${JSON.stringify(frame.swap)} is not ${BASE} or in ${path}.variants` })
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
      for (const [channel, value] of Object.entries(frame.swap ?? {})) {
        if (!isChannel(pack, channel)) {
          errors.push({ path: `${at}.swap.${channel}`, message: `${JSON.stringify(channel)} is not ${FIGURE}, a group, or a slot` })
        } else if (!isChannelValue(pack, channel, value)) {
          errors.push({ path: `${at}.swap.${channel}`, message: `${JSON.stringify(value)} is not ${BASE} or a variant of ${channel}` })
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
  const checkParts = (selection: Readonly<Record<string, string>>, path: string): void => {
    for (const [slot, name] of Object.entries(selection)) {
      if (partOf(pack, slot, name) === undefined) {
        errors.push({ path: `${path}.${slot}`, message: `${JSON.stringify(name)} is not a part in parts.${slot}` })
      }
    }
  }
  checkParts(pack.defaults?.parts ?? {}, 'defaults.parts')
  for (const [role, outfits] of Object.entries(pack.roles ?? {})) {
    outfits.forEach((outfit, i) => checkParts(outfit.parts, `roles.${role}[${i}].parts`))
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
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the schema check passed, and packSchema is the format of Pack.
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
    return { ok: false, errors: [{ path: '(root)', message: `is not JSON: ${error instanceof Error ? error.message : String(error)}` }] }
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

/**
 * The same picture at half size: each 2 x 2 block becomes one pixel. A block
 * with two or more opaque pixels is opaque, in its most common color; on a tie,
 * the first of them in reading order. One-pixel details, such as an eye, can
 * go away.
 */
export function halve(grid: PixelGrid): PixelGrid {
  const width = Math.ceil(grid.width / 2)
  const height = Math.ceil(grid.height / 2)
  const at = (x: number, y: number): number | null => (x < grid.width && y < grid.height ? (grid.pixels[y * grid.width + x] ?? null) : null)
  const pixels: (number | null)[] = []
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const block = [at(2 * x, 2 * y), at(2 * x + 1, 2 * y), at(2 * x, 2 * y + 1), at(2 * x + 1, 2 * y + 1)].filter(c => c !== null)
      const counts = new Map<number, number>()
      for (const color of block) counts.set(color, (counts.get(color) ?? 0) + 1)
      const top = [...counts].reduce<[number, number] | null>((best, entry) => (best === null || entry[1] > best[1] ? entry : best), null)
      pixels.push(block.length >= 2 && top !== null ? top[0] : null)
    }
  }
  return { width, height, pixels }
}

/** The frame operations to apply: one body frame, and one frame for each slot whose part moves. */
export type Pose = { body?: Frame; parts?: Readonly<Record<string, PartFrame>> }

const NO_MOVE: Move = [0, 0]

function moved([x, y]: Point, ...moves: (Move | undefined)[]): Point {
  return moves.reduce<Point>(([px, py], m = NO_MOVE) => [px + m[0], py + m[1]], [x, y])
}

/**
 * Draws the tree. The root's variant first, if the pose names one; then the
 * groups in their order, each with its pivot on its parent's anchor; then one
 * part for each selected slot, on its anchor. A group that a hidden node or a
 * covering variant above it hides is not drawn, and a part on a missing
 * anchor is not drawn. The pose moves, swaps, hides, and recolors what it
 * names; moving or hiding a node moves or hides the nodes on it.
 */
export function compose(pack: Pack, selection: PartSelection = pack.defaults?.parts ?? {}, pose: Pose = {}): PixelGrid {
  const { grid } = pack
  const { offset = {}, swap = {}, hide = [], palette: framePalette } = pose.body ?? {}
  const tree = treeOf(pack)
  const hidden = new Set(hide)
  const pixels: (number | null)[] = Array.from({ length: grid.width * grid.height }, () => null)
  const variantOf = (node: string): Variant | undefined => {
    const value = own(swap, node)
    return value === undefined || value === BASE ? undefined : own(variantsOf(pack, node), value)
  }
  // The nearest node above `node` whose drawing covers it.
  // The outermost node above `node` whose drawing covers it: a cover under another cover is not drawn either.
  const coverOf = (node: string): string | undefined =>
    lineage(tree, node)
      .slice(1)
      .findLast(n => covers(variantOf(n)))
  const origins = new Map<string, Point | null>()
  const anchorPoint = (name: string): Point | null => {
    const holder = tree.owner.get(name)
    if (holder === undefined) return null
    const cover = coverOf(holder)
    if (cover !== undefined) {
      const point = own(variantAnchors(variantOf(cover)), name)
      const at = originOf(cover)
      return point === undefined || at === null ? null : moved(at, point)
    }
    const at = originOf(holder)
    const base = holder === FIGURE ? own(pack.anchors, name) : own(own(pack.groups, holder)?.anchors, name)
    const point = own(variantAnchors(variantOf(holder)), name) ?? base
    return point === undefined || at === null ? null : moved(at, point)
  }
  // The top left of a node on the grid; `null` when its anchor is not placed.
  const originOf = (node: string): Point | null => {
    if (origins.has(node)) return origins.get(node) ?? null
    origins.set(node, null)
    let at: Point | null
    const group = own(pack.groups, node)
    if (node === FIGURE) at = moved([0, 0], own(offset, '*'))
    else if (group === undefined) at = null
    else if (group.anchor === undefined) at = moved(group.at ?? [0, 0], own(offset, '*'), own(offset, node))
    else {
      const anchor = anchorPoint(group.anchor)
      const [px, py] = group.pivot ?? [0, 0]
      at = anchor === null ? null : moved([anchor[0] - px, anchor[1] - py], own(offset, node))
    }
    origins.set(node, at)
    return at
  }
  const isHidden = (node: string): boolean => lineage(tree, node).some(n => hidden.has(n)) || coverOf(node) !== undefined
  const bodyPalette = { ...pack.palette, ...framePalette }

  const figure = variantOf(FIGURE)
  if (figure !== undefined) paint(pixels, grid, variantRows(figure), bodyPalette, originOf(FIGURE) ?? [0, 0])
  for (const [name, group] of Object.entries(pack.groups)) {
    const at = originOf(name)
    if (at === null || isHidden(name)) continue
    const variant = variantOf(name)
    paint(pixels, grid, variant === undefined ? group.rows : variantRows(variant), bodyPalette, at)
  }
  for (const [slot, name] of Object.entries(selection)) {
    const part = partOf(pack, slot, name)
    const frame = own(pose.parts, slot) ?? {}
    if (part === undefined || hidden.has(slot) || frame.hide === true) continue
    const holder = tree.owner.get(part.anchor)
    if (holder === undefined || lineage(tree, holder).some(n => hidden.has(n))) continue
    const anchor = anchorPoint(part.anchor)
    if (anchor === null) continue
    // The part's own motion swaps over the slot's channel value.
    const value = frame.swap ?? own(swap, slot)
    const variant = value === undefined || value === BASE ? undefined : own(part.variants, value)
    const rows = variant === undefined ? part.rows : variantRows(variant)
    const origin = moved([anchor[0] - part.pivot[0], anchor[1] - part.pivot[1]], own(offset, slot), frame.offset)
    paint(pixels, grid, rows, { ...pack.palette, ...part.palette, ...framePalette, ...frame.palette }, origin)
  }
  return { width: grid.width, height: grid.height, pixels }
}
