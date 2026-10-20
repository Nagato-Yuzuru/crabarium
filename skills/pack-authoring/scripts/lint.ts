// Art checks that the schema cannot make: is the character readable in a
// terminal? Each finding names a figure, a field, or a pixel, so that the
// author can fix it without a guess. Pure.
import { compose, halve, variantRows } from '../../../hooks/core/pack/pack.ts'
import type { Pack, PartSelection, PixelGrid, Pose, Rows, Variants } from '../../../hooks/core/pack/pack.ts'
import { ROLES } from '../../../hooks/core/pack/schema.ts'
import { BACKGROUNDS, outfitFigures, stateFigures } from './sheet.ts'
import type { Figure } from './sheet.ts'

export type Severity = 'error' | 'warning'
export type Finding = { severity: Severity; rule: string; where: string; message: string }

/** Two outfits must differ in at least this many pixels to tell them apart. */
export const MIN_OUTFIT_DIFFERENCE = 4
/** Two palette colors closer than this (redmean distance, 0 to about 765) look the same in a terminal. */
export const MIN_COLOR_DISTANCE = 32
/** A pixel with a contrast ratio under this against a terminal background fades into it. */
export const MIN_CONTRAST = 1.6
/** A shape (the body or a part) may fade in up to this share of its pixels: an outline, for example. */
export const MAX_FADED_SHARE = 0.5
/** From this share of faded pixels, the shape is gone: an error. */
export const GONE_SHARE = 0.8

const hex = (color: number): string => `#${color.toString(16).padStart(6, '0')}`

function at(grid: PixelGrid, x: number, y: number): number | null {
  return x < 0 || y < 0 || x >= grid.width || y >= grid.height ? null : (grid.pixels[y * grid.width + x] ?? null)
}

/** The 8-connected pieces of opaque pixels, largest first, each as its pixel list. */
export function pieces(grid: PixelGrid): [number, number][][] {
  const seen = new Set<number>()
  const found: [number, number][][] = []
  grid.pixels.forEach((color, start) => {
    if (color === null || seen.has(start)) return
    const piece: [number, number][] = []
    const stack = [start]
    seen.add(start)
    while (stack.length > 0) {
      const i = stack.pop()!
      const x = i % grid.width
      const y = Math.floor(i / grid.width)
      piece.push([x, y])
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const j = (y + dy) * grid.width + x + dx
          if (at(grid, x + dx, y + dy) !== null && !seen.has(j)) {
            seen.add(j)
            stack.push(j)
          }
        }
      }
    }
    found.push(piece)
  })
  return found.toSorted((a, b) => b.length - a.length)
}

function difference(a: PixelGrid, b: PixelGrid): number {
  return a.pixels.reduce<number>((n, color, i) => (color === b.pixels[i] ? n : n + 1), 0)
}

function clipped(pack: Pack, parts: PartSelection, pose: Pose): [number, number][] {
  // A margin of m pixels on each side, so that compose keeps what the real grid clips: a bigger grid, and the whole figure moved in by m.
  const m = 32
  const [dx, dy] = pose.body?.offset?.['*'] ?? [0, 0]
  const big = compose({ ...pack, grid: { width: pack.grid.width + 2 * m, height: pack.grid.height + 2 * m } }, parts, {
    ...pose,
    body: { ...pose.body, offset: { ...pose.body?.offset, '*': [dx + m, dy + m] } },
  })
  const out: [number, number][] = []
  big.pixels.forEach((color, i) => {
    const x = (i % big.width) - m
    const y = Math.floor(i / big.width) - m
    if (color !== null && (x < 0 || y < 0 || x >= pack.grid.width || y >= pack.grid.height)) out.push([x, y])
  })
  return out
}

const linear = (c: number): number => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)

function luminance(color: number): number {
  const [r, g, b] = [16, 8, 0].map(s => linear(((color >> s) & 0xff) / 255))
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

export function contrast(a: number, b: number): number {
  const [hi, lo] = [luminance(a), luminance(b)].toSorted((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

export function colorDistance(a: number, b: number): number {
  const [r1, g1, b1] = [16, 8, 0].map(s => (a >> s) & 0xff)
  const [r2, g2, b2] = [16, 8, 0].map(s => (b >> s) & 0xff)
  const mean = (r1! + r2!) / 2
  return Math.sqrt((2 + mean / 256) * (r1! - r2!) ** 2 + 4 * (g1! - g2!) ** 2 + (2 + (255 - mean) / 256) * (b1! - b2!) ** 2)
}

const points = (list: readonly (readonly [number, number])[], most = 6): string =>
  list
    .slice(0, most)
    .map(([x, y]) => `(${x},${y})`)
    .join(' ') + (list.length > most ? ` and ${list.length - most} more` : '')

function figureChecks(pack: Pack, figure: Figure, where: string): Finding[] {
  const findings: Finding[] = []
  const grid = compose(pack, figure.parts, figure.pose)
  const [body, ...rest] = pieces(grid)
  for (const piece of rest) {
    const small = piece.length <= 2
    findings.push({
      severity: small ? 'error' : 'warning',
      rule: small ? 'speck' : 'detached',
      where,
      message: small
        ? `stray pixel${piece.length > 1 ? 's' : ''} at ${points(piece)}, apart from the body: remove or join ${piece.length > 1 ? 'them' : 'it'}`
        : `a piece of ${piece.length} pixels at ${points(piece, 3)} does not touch the body (${body?.length ?? 0} pixels); it reads as a second object`,
    })
  }
  const out = clipped(pack, figure.parts, figure.pose)
  if (out.length > 0) {
    findings.push({
      severity: 'error',
      rule: 'clipped',
      where,
      message: `${out.length} pixels fall outside the ${pack.grid.width}x${pack.grid.height} grid at ${points(out)}: move the group or part, or grow the grid`,
    })
  }
  return findings
}

function eyeChecks(pack: Pack, figure: Figure, where: string): Finding[] {
  const eyes = Object.keys(pack.groups).filter(name => /eye/i.test(name))
  if (eyes.length === 0) return []
  // The eye pixels are where the figure changes when the eye groups are hidden; this finds them on any node of the tree.
  const bare = compose(pack, {}, figure.pose)
  const blind = compose(pack, {}, { ...figure.pose, body: { ...figure.pose.body, hide: [...(figure.pose.body?.hide ?? []), ...eyes] } })
  const dressed = compose(pack, figure.parts, figure.pose)
  const covered: [number, number][] = []
  bare.pixels.forEach((color, i) => {
    if (color !== blind.pixels[i] && color !== dressed.pixels[i]) covered.push([i % bare.width, Math.floor(i / bare.width)])
  })
  if (covered.length === 0) return []
  const parts = Object.entries(figure.parts).map(([slot, name]) => `${slot}:${name}`)
  return [{ severity: 'error', rule: 'covers-eyes', where, message: `${parts.join(' ')} covers the eyes at ${points(covered)}` }]
}

// An outfit label is the role, then the outfit number when it has several.
const roleOf = (label: string): string => label.split(' ')[0]!

function outfitChecks(pack: Pack): Finding[] {
  const findings: Finding[] = []
  const figures = outfitFigures(pack)
  const grids = figures.map(f => compose(pack, f.parts, f.pose))
  figures.forEach((a, i) => {
    figures.slice(i + 1).forEach((b, k) => {
      const j = i + 1 + k
      if (roleOf(a.label) === roleOf(b.label)) return
      const n = difference(grids[i]!, grids[j]!)
      if (n >= MIN_OUTFIT_DIFFERENCE) return
      const isDefault = a.label === 'default'
      findings.push({
        severity: isDefault ? 'warning' : 'error',
        rule: 'same-look',
        where: `roles.${roleOf(b.label)}`,
        message: `${b.label} and ${a.label} differ in ${n} pixel${n === 1 ? '' : 's'}; a viewer cannot tell them apart. Give one a part that changes the silhouette`,
      })
    })
  })
  const missing = ROLES.filter(role => (pack.roles?.[role] ?? []).length === 0)
  if (missing.length > 0) {
    findings.push({
      severity: 'warning',
      rule: 'no-outfit',
      where: 'roles',
      message: `no outfit for ${missing.join(', ')}: these agents wear the defaults`,
    })
  }
  return findings
}

function paletteChecks(pack: Pack): Finding[] {
  const findings: Finding[] = []
  const entries: { where: string; key: string; color: number }[] = []
  const add = (where: string, palette: Readonly<Record<string, string>> | undefined) => {
    for (const [key, value] of Object.entries(palette ?? {})) entries.push({ where, key, color: Number.parseInt(value.slice(1), 16) })
  }
  add('palette', pack.palette)
  for (const [slot, parts] of Object.entries(pack.parts ?? {}))
    for (const [name, part] of Object.entries(parts)) add(`parts.${slot}.${name}.palette`, part.palette)
  entries.forEach((a, i) => {
    entries.slice(i + 1).forEach(b => {
      if (a.color === b.color) return
      const d = colorDistance(a.color, b.color)
      if (d >= MIN_COLOR_DISTANCE) return
      findings.push({
        severity: 'warning',
        rule: 'close-colors',
        where: b.where,
        message: `"${b.key}" ${hex(b.color)} and "${a.key}" ${hex(a.color)} (${a.where}) are ${Math.round(d)} apart; in a terminal they look the same. Merge them or move them apart`,
      })
    })
  })

  const used = new Set<string>()
  const use = (rows: Rows) => rows.forEach(row => [...row].forEach(key => used.add(key)))
  const useAll = (variants: Variants | undefined) => Object.values(variants ?? {}).forEach(v => use(variantRows(v)))
  useAll(pack.figure?.variants)
  for (const group of Object.values(pack.groups)) {
    use(group.rows)
    useAll(group.variants)
  }
  for (const parts of Object.values(pack.parts ?? {})) {
    for (const part of Object.values(parts)) {
      use(part.rows)
      useAll(part.variants)
    }
  }
  const unused = Object.keys(pack.palette).filter(key => !used.has(key))
  if (unused.length > 0) {
    findings.push({ severity: 'warning', rule: 'unused', where: 'palette', message: `palette keys used by no rows: ${unused.join(' ')}` })
  }

  const worn = new Set<string>()
  const wear = (parts: PartSelection | undefined) => Object.entries(parts ?? {}).forEach(([slot, name]) => worn.add(`${slot}.${name}`))
  wear(pack.defaults?.parts)
  for (const outfits of Object.values(pack.roles ?? {})) outfits.forEach(o => wear(o.parts))
  const idle = Object.entries(pack.parts ?? {})
    .flatMap(([slot, parts]) => Object.keys(parts).map(name => `${slot}.${name}`))
    .filter(p => !worn.has(p))
  if (idle.length > 0) {
    findings.push({
      severity: 'warning',
      rule: 'unused',
      where: 'parts',
      message: `parts that no role and no default wears: ${idle.join(' ')}`,
    })
  }
  return findings
}

// A transparent pixel shows the terminal background, so the body and each part
// must stay visible on a dark and on a light one. A faded outline is fine when
// the fill inside it shows; a part whose pixels mostly fade is gone (a white
// hat on a light terminal).
function fadeChecks(pack: Pack): Finding[] {
  const findings: Finding[] = []
  const shapes: { where: string; grid: PixelGrid }[] = [{ where: 'groups', grid: compose(pack, {}) }]
  const bare: Pack = { ...pack, groups: {} }
  for (const [slot, parts] of Object.entries(pack.parts ?? {})) {
    for (const name of Object.keys(parts)) shapes.push({ where: `parts.${slot}.${name}`, grid: compose(bare, { [slot]: name }) })
  }
  for (const { where, grid } of shapes) {
    const pixels = grid.pixels.filter((c): c is number => c !== null)
    if (pixels.length === 0) continue
    for (const [name, background] of Object.entries(BACKGROUNDS)) {
      const faint = pixels.filter(color => contrast(color, background) < MIN_CONTRAST)
      const share = faint.length / pixels.length
      if (share <= MAX_FADED_SHARE) continue
      const colors = [...new Set(faint)].map(hex).join(' ')
      findings.push({
        severity: share >= GONE_SHARE ? 'error' : 'warning',
        rule: 'contrast',
        where,
        message: `${Math.round(share * 100)}% of its pixels fade into a ${name} terminal (${hex(background)}); colors ${colors}. Change the fill, or give it an outline that shows on ${name}`,
      })
    }
  }
  return findings
}

function smallChecks(pack: Pack): Finding[] {
  const grid = compose(pack)
  const small = new Set(halve(grid).pixels)
  const lost = [...new Set(grid.pixels)].filter((c): c is number => c !== null && !small.has(c))
  if (lost.length === 0) return []
  const keys = (color: number) =>
    Object.entries(pack.palette)
      .filter(([, value]) => Number.parseInt(value.slice(1), 16) === color)
      .map(([key]) => `"${key}"`)
  return [
    {
      severity: 'warning',
      rule: 'small-size',
      where: 'groups',
      message: `at the small size (half, for narrow panes) these colors go away: ${lost.map(c => [hex(c), ...keys(c)].join(' ')).join(', ')}. A feature in them (eyes, for example) stays only as a 2 x 2 block at an even x and y`,
    },
  ]
}

function motionChecks(pack: Pack): Finding[] {
  const findings: Finding[] = []
  for (const { state, motion, figures } of stateFigures(pack)) {
    if (figures.length < 2) continue
    const grids = figures.map(f => compose(pack, f.parts, f.pose))
    if (grids.every(g => difference(g, grids[0]!) === 0)) {
      findings.push({
        severity: 'error',
        rule: 'no-move',
        where: `motions.${motion}`,
        message: `${state} plays ${motion}, but its frames all look the same`,
      })
      continue
    }
    grids.forEach((g, i) => {
      if (i > 0 && difference(g, grids[i - 1]!) === 0) {
        findings.push({
          severity: 'warning',
          rule: 'repeat-frame',
          where: `motions.${motion}.frames[${i}]`,
          message: `frame ${i + 1} looks the same as frame ${i}`,
        })
      }
    })
  }
  return findings
}

/** All findings, errors first. */
export function lintPack(pack: Pack): Finding[] {
  const outfits = outfitFigures(pack)
  const frames = stateFigures(pack).flatMap(({ state, figures }) =>
    figures.map(f => ({ figure: f, where: `states.${state} frame ${f.label}` })),
  )
  const findings = [
    ...outfits.flatMap(f => figureChecks(pack, f, `outfit ${f.label}`).concat(eyeChecks(pack, f, `outfit ${f.label}`))),
    ...frames.flatMap(({ figure, where }) => figureChecks(pack, figure, where)),
    ...outfitChecks(pack),
    ...paletteChecks(pack),
    ...fadeChecks(pack),
    ...smallChecks(pack),
    ...motionChecks(pack),
  ]
  // A frame repeats the outfit's finding when the motion does not cause it.
  const seen = new Set<string>()
  const unique = findings.filter(f => {
    const key = `${f.rule}|${f.message}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return unique.toSorted((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1))
}
