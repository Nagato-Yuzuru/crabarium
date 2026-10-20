import { describe, expect, test } from 'claude-code/testing'

import { compose, parsePack } from '../hooks/core/pack/pack.ts'
import type { Pack, Pose } from '../hooks/core/pack/pack.ts'

const R = 0xff0000
const G = 0x00ff00
const B = 0x0000ff
const _ = null

// A 4 x 4 figure: a red shell at the top left with an eye anchor, a green eye
// on it, and a blue hat on the shell's head anchor. The root has a covering
// whole-figure drawing, `turn`, that places the head anchor and not the eye.
const pack = (() => {
  const result = parsePack({
    formatVersion: 1,
    name: 'tree',
    author: 'test',
    license: 'MIT',
    grid: { width: 4, height: 4 },
    palette: { r: '#ff0000', g: '#00ff00', b: '#0000ff' },
    figure: { variants: { turn: { rows: ['rrrr', 'rrrr'], anchors: { head: [3, 3] }, covers: true } } },
    groups: {
      shell: {
        at: [0, 1],
        anchors: { eye: [1, 0], head: [0, 0] },
        rows: ['rr', 'rr'],
        variants: { squash: { rows: ['rrr'], anchors: { eye: [2, 0], head: [0, 0] } } },
      },
      eye: { anchor: 'eye', pivot: [0, 0], rows: ['g'], variants: { shut: ['r'] } },
    },
    parts: { hat: { cap: { anchor: 'head', pivot: [0, 1], rows: ['b'], variants: { glow: ['g'] } } } },
  })
  if (!result.ok) throw new Error(JSON.stringify(result.errors))
  return result.pack
})()

function draw(pose: Pose, target: Pack = pack): readonly (number | null)[] {
  return compose(target, { hat: 'cap' }, pose).pixels
}

describe('compose on the part tree', () => {
  test('a group sits with its pivot on its parent anchor, and a part on the anchor of a group', () => {
    // prettier-ignore
    expect(draw({})).toEqual([
      B, _, _, _,
      R, G, _, _,
      R, R, _, _,
      _, _, _, _,
    ])
  })

  test('moving a group moves the groups and parts on it', () => {
    // prettier-ignore
    expect(draw({ body: { offset: { shell: [1, 1] } } })).toEqual([
      _, _, _, _,
      _, B, _, _,
      _, R, G, _,
      _, R, R, _,
    ])
  })

  test('a variant places its own anchors, so what is on them follows', () => {
    // prettier-ignore
    expect(draw({ body: { swap: { shell: 'squash' } } })).toEqual([
      B, _, _, _,
      R, R, G, _,
      _, _, _, _,
      _, _, _, _,
    ])
  })

  test('the child keeps its own channel when the parent changes', () => {
    // prettier-ignore
    expect(draw({ body: { swap: { shell: 'squash', eye: 'shut' } } })).toEqual([
      B, _, _, _,
      R, R, R, _,
      _, _, _, _,
      _, _, _, _,
    ])
  })

  test('a covering variant draws in place of the groups; a part goes to the anchor that it places', () => {
    // prettier-ignore
    expect(draw({ body: { swap: { figure: 'turn' } } })).toEqual([
      R, R, R, R,
      R, R, R, R,
      _, _, _, B,
      _, _, _, _,
    ])
  })

  test('hiding a group hides the groups and parts on it', () => {
    expect(draw({ body: { hide: ['shell'] } }).every(c => c === null)).toBe(true)
  })

  test('a slot is a channel: its value selects a part variant, and the part motion swaps over it', () => {
    expect(draw({ body: { swap: { hat: 'glow' } } })[0]).toBe(G)
    expect(draw({ body: { swap: { hat: 'glow' } }, parts: { hat: { swap: 'base' } } })[0]).toBe(B)
  })

  test('under two covers, the outermost one places the anchors: a hidden cover places nothing', () => {
    const result = parsePack({
      formatVersion: 1,
      name: 'nested',
      author: 'test',
      license: 'MIT',
      grid: { width: 4, height: 4 },
      palette: { r: '#ff0000', b: '#0000ff' },
      anchors: { shoulder: [0, 0] },
      figure: { variants: { turn: { rows: ['r'], anchors: { tip: [3, 3] }, covers: true } } },
      groups: {
        arm: {
          at: [0, 0],
          anchors: { wrist: [0, 1] },
          rows: ['r'],
          variants: { curl: { rows: ['r'], anchors: { tip: [0, 0] }, covers: true } },
        },
        hand: { anchor: 'wrist', pivot: [0, 0], anchors: { tip: [0, 1] }, rows: ['r'] },
      },
      parts: { held: { ball: { anchor: 'tip', pivot: [0, 0], rows: ['b'] } } },
    })
    if (!result.ok) throw new Error(JSON.stringify(result.errors))
    const drawn = compose(result.pack, { held: 'ball' }, { body: { swap: { figure: 'turn', arm: 'curl' } } }).pixels
    expect(drawn.indexOf(B)).toBe(3 * 4 + 3)
  })
})
