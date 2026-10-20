// The pane's half-block cells as 24-bit ANSI text, so a terminal shows a
// character as the pane would. Pure.
import type { PixelGrid } from '../../../hooks/core/pack/pack.ts'
import { DEFAULT_COLOR, halfBlockCells } from '../../../hooks/view/raster.ts'

const RESET = '\u001b[0m'

function sgr(color: number, layer: 38 | 48): string {
  if (color === DEFAULT_COLOR) return `\u001b[${layer + 1}m`
  return `\u001b[${layer};2;${(color >> 16) & 0xff};${(color >> 8) & 0xff};${color & 0xff}m`
}

/** The figures side by side, `gap` columns apart, one text line per cell row. */
export function ansiRow(grids: readonly PixelGrid[], gap = 2): string {
  const cells = grids.map(halfBlockCells)
  const rows = Math.max(0, ...cells.map(c => c.rows))
  const lines: string[] = []
  for (let row = 0; row < rows; row += 1) {
    let line = ''
    for (const { columns, rows: height, words } of cells) {
      // Codes only where a color changes, so the text stays short.
      let fg = DEFAULT_COLOR
      let bg = DEFAULT_COLOR
      for (let x = 0; x < columns; x += 1) {
        const i = (row * columns + x) * 3
        const [char, f, b] = row < height ? [words[i]!, words[i + 1]!, words[i + 2]!] : [0x20, DEFAULT_COLOR, DEFAULT_COLOR]
        if (f !== fg) line += sgr(f, 38)
        if (b !== bg) line += sgr(b, 48)
        ;[fg, bg] = [f, b]
        line += String.fromCodePoint(char)
      }
      line += RESET + ' '.repeat(gap)
    }
    lines.push(line.trimEnd() + RESET)
  }
  return lines.join('\n')
}
