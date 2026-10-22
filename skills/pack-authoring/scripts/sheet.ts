// The contact sheet of a pack: each outfit, each state's frames, and the
// small size, on a dark and on a light terminal background. Pure: it gives
// RGBA pixels, and the caller encodes them.
import { pickOutfit } from '../../../hooks/core/avatar/select.ts'
import { onPose, usable } from '../../../hooks/core/character.ts'
import { compose, halve } from '../../../hooks/core/pack/pack.ts'
import type { Pack, PartSelection, PixelGrid, Pose, Role } from '../../../hooks/core/pack/pack.ts'
import type { Rule } from '../../../hooks/core/pack/rules.ts'
import { CHARACTER_STATES, ROLES } from '../../../hooks/core/pack/schema.ts'
import { motionNamed, styleOf } from '../../../hooks/core/pack/style.ts'
import { GLYPH_HEIGHT, GLYPH_WIDTH, glyph, textWidth } from './font.ts'

/** RGBA, 4 bytes per pixel, row-major. */
export type Image = { width: number; height: number; data: Uint8Array }

/** Terminal backgrounds that a transparent pixel shows. */
export const BACKGROUNDS = { dark: 0x1e1e1e, light: 0xf4f4f4 } as const

/** A figure to draw: a label, an outfit, and a pose. */
export type Figure = { label: string; parts: PartSelection; pose: Pose }

// A role's base pose when it stands still: its idle style with no motion.
function stillPose(pack: Pack, rules: readonly Rule[], role: Role | null, parts: PartSelection): Pose {
  return { body: onPose(pack, styleOf(pack, rules, { role, state: 'idle', parts }), undefined, parts) }
}

/** The pack defaults, then each outfit of each role, standing still in the role's base pose. */
export function outfitFigures(pack: Pack, rules: readonly Rule[] = []): Figure[] {
  const defaults = pack.defaults?.parts ?? {}
  const figures: Figure[] = [{ label: 'default', parts: defaults, pose: stillPose(pack, rules, null, defaults) }]
  for (const role of ROLES) {
    const outfits = pack.roles?.[role] ?? []
    outfits.forEach((outfit, i) => {
      // One outfit at a time: pickOutfit fills the other slots from the defaults.
      const parts = pickOutfit(pack, [outfit], role)
      if (parts === null) return
      figures.push({ label: outfits.length > 1 ? `${role} ${i + 1}` : role, parts, pose: stillPose(pack, rules, role, parts) })
    })
  }
  return figures
}

/** Each frame of each state's motion, in the default outfit, on the base pose. A state with no motion shows one still frame. */
export function stateFigures(pack: Pack, rules: readonly Rule[] = []): { state: string; motion: string; figures: Figure[] }[] {
  const parts = pack.defaults?.parts ?? {}
  return CHARACTER_STATES.map(state => {
    const style = styleOf(pack, rules, { role: null, state, parts })
    const motion = style.play === null ? null : motionNamed(pack, style.play)
    const frames = motion === null ? [undefined] : motion.frames
    return {
      state,
      motion: style.play ?? 'still',
      figures: frames.map((frame, i) => ({ label: `${i + 1}`, parts, pose: { body: onPose(pack, style, frame, parts) } })),
    }
  })
}

/**
 * Each frame of each track 1 motion that can play, in the default outfit, on
 * the base pose of a state that plays it: the tricks of each state that has
 * `idle-every`, and the `once` motion of `finished` and `failed`. A motion on
 * the same pose shows once, with the first state that plays it.
 */
export function trackOneFigures(pack: Pack, rules: readonly Rule[] = []): { state: string; motion: string; figures: Figure[] }[] {
  const parts = pack.defaults?.parts ?? {}
  const rows = new Map<string, { state: string; motion: string; figures: Figure[] }>()
  for (const state of CHARACTER_STATES) {
    const style = styleOf(pack, rules, { role: null, state, parts })
    const once = state === 'finished' || state === 'failed' ? style.once[state] : undefined
    const kinds = [
      ...(style.idleEvery === null ? [] : usable(pack, style, style.tricks, parts).map(choice => ({ kind: 'trick', choice }))),
      ...(once === undefined ? [] : usable(pack, style, once, parts).map(choice => ({ kind: 'once', choice }))),
    ]
    for (const { kind, choice } of kinds) {
      const key = `${kind} ${choice.name} ${JSON.stringify(style.pose)}`
      if (rows.has(key)) continue
      const figures = choice.motion.frames.map((frame, i) => ({
        label: `${i + 1}`,
        parts,
        pose: { body: onPose(pack, style, frame, parts) },
      }))
      rows.set(key, { state: `${state} ${kind}`, motion: choice.name, figures })
    }
  }
  return [...rows.values()]
}

class Canvas {
  readonly data: Uint8Array
  readonly width: number
  readonly height: number

  constructor(width: number, height: number, color: number) {
    this.width = width
    this.height = height
    this.data = new Uint8Array(width * height * 4)
    this.rect(0, 0, width, height, color)
  }

  rect(x0: number, y0: number, w: number, h: number, color: number): void {
    for (let y = Math.max(0, y0); y < Math.min(this.height, y0 + h); y += 1) {
      for (let x = Math.max(0, x0); x < Math.min(this.width, x0 + w); x += 1) {
        const i = (y * this.width + x) * 4
        this.data[i] = (color >> 16) & 0xff
        this.data[i + 1] = (color >> 8) & 0xff
        this.data[i + 2] = color & 0xff
        this.data[i + 3] = 0xff
      }
    }
  }

  text(text: string, x: number, y: number, scale: number, color: number): void {
    ;[...text].forEach((char, i) => {
      for (const [gx, gy] of glyph(char)) this.rect(x + (i * (GLYPH_WIDTH + 1) + gx) * scale, y + gy * scale, scale, scale, color)
    })
  }

  grid(grid: PixelGrid, x: number, y: number, scale: number, lines: number | null): void {
    grid.pixels.forEach((color, i) => {
      if (color !== null) this.rect(x + (i % grid.width) * scale, y + Math.floor(i / grid.width) * scale, scale, scale, color)
    })
    if (lines === null || scale < 4) return
    for (let gx = 0; gx <= grid.width; gx += 1) this.rect(x + gx * scale, y, 1, grid.height * scale, gx % 4 === 0 ? lines : mix(lines, 0.5))
    for (let gy = 0; gy <= grid.height; gy += 1) this.rect(x, y + gy * scale, grid.width * scale, 1, gy % 4 === 0 ? lines : mix(lines, 0.5))
  }

  image(): Image {
    return { width: this.width, height: this.height, data: this.data }
  }
}

function mix(color: number, alpha: number): number {
  const channel = (shift: number) => Math.round(((color >> shift) & 0xff) * alpha + 0x80 * (1 - alpha))
  return (channel(16) << 16) | (channel(8) << 8) | channel(0)
}

function ink(background: number): number {
  return background === BACKGROUNDS.dark ? 0xd0d0d0 : 0x303030
}

export type SheetOptions = {
  /** `inspect`: labels, a pixel grid, the states and the small size. `critic`: only the outfits at terminal size, unlabeled. */
  mode: 'inspect' | 'critic'
  /** The widest sheet in pixels; the scale shrinks to fit. */
  maxWidth?: number
  /** The rules of the pack's pack.css. */
  rules?: readonly Rule[]
}

/** Each terminal cell is about 8 screen pixels wide, so 8 is the size a user sees. */
export const TERMINAL_SCALE = 8

/** The contact sheet of `pack`. */
export function contactSheet(pack: Pack, options: SheetOptions): Image {
  const { width: w, height: h } = pack.grid
  const outfits = outfitFigures(pack, options.rules)
  if (options.mode === 'critic') {
    const gap = TERMINAL_SCALE * 2
    const cellW = w * TERMINAL_SCALE + gap
    const bandH = h * TERMINAL_SCALE + gap * 2
    const canvas = new Canvas(gap + outfits.length * cellW, bandH * 2, BACKGROUNDS.dark)
    canvas.rect(0, bandH, canvas.width, bandH, BACKGROUNDS.light)
    outfits.forEach((figure, i) => {
      const grid = compose(pack, figure.parts, figure.pose)
      canvas.grid(grid, gap + i * cellW, gap, TERMINAL_SCALE, null)
      canvas.grid(grid, gap + i * cellW, bandH + gap, TERMINAL_SCALE, null)
    })
    return canvas.image()
  }

  const states = [...stateFigures(pack, options.rules), ...trackOneFigures(pack, options.rules)]
  const columns = Math.max(outfits.length, 1 + Math.max(...states.map(s => s.figures.length)))
  const maxWidth = options.maxWidth ?? 1500
  const scale = Math.max(4, Math.min(16, Math.floor(maxWidth / (columns * (w + 3)))))
  const label = Math.max(2, Math.floor(scale / 4))
  const labelH = (GLYPH_HEIGHT + 2) * label
  const pad = scale
  const cellW = w * scale + pad * 2
  const cellH = h * scale + labelH + pad * 2
  const titleH = labelH + pad
  // Rows of one band: a title, the outfits, the small size, then one row per state.
  const bandH = titleH + cellH * (2 + states.length)
  const canvas = new Canvas(Math.max(columns * cellW, textWidth(pack.name) * label + pad * 2), bandH * 2, BACKGROUNDS.dark)
  canvas.rect(0, bandH, canvas.width, bandH, BACKGROUNDS.light)

  for (const [band, background] of [BACKGROUNDS.dark, BACKGROUNDS.light].entries()) {
    const top = band * bandH
    const color = ink(background)
    canvas.text(`${pack.name} ${w}x${h} on ${band === 0 ? 'dark' : 'light'}`, pad, top + pad, label, color)
    const cell = (row: number, column: number, grid: PixelGrid, text: string, cellScale = scale) => {
      const x = column * cellW + pad
      const y = top + titleH + row * cellH + pad
      canvas.grid(grid, x, y, cellScale, mix(color, 0.35))
      canvas.text(text, x, y + h * scale + label, label, color)
    }
    outfits.forEach((figure, i) => cell(0, i, compose(pack, figure.parts, figure.pose), figure.label))
    outfits.forEach((figure, i) => cell(1, i, halve(compose(pack, figure.parts, figure.pose)), `${figure.label} small`))
    states.forEach(({ state, motion, figures }, row) => {
      const y = top + titleH + (row + 2) * cellH + pad
      canvas.text(state, pad, y, label, color)
      canvas.text(motion, pad, y + labelH, label, color)
      figures.forEach((figure, i) => cell(row + 2, i + 1, compose(pack, figure.parts, figure.pose), `${state} ${figure.label}`))
    })
  }
  return canvas.image()
}
