import { describe, expect, test } from 'claude-code/testing'

import type { AgentRow } from '../hooks/core/agents.ts'
import { characterPose, frameAt } from '../hooks/core/character.ts'
import type { Look } from '../hooks/core/character.ts'
import { loadPack } from '../hooks/core/pack/load.ts'
import type { Pack } from '../hooks/core/pack/pack.ts'
import type { Rule } from '../hooks/core/pack/rules.ts'
import { MAX_CSS_CHARS, MAX_PACK_BYTES } from '../hooks/core/pack/schema.ts'
import { styleOf } from '../hooks/core/pack/style.ts'
import type { Tags } from '../hooks/core/pack/style.ts'

// A body with an arm that has variants, a cover over the whole figure, and a hammer.
const json = JSON.stringify({
  formatVersion: 1,
  name: 'style',
  author: 'test',
  license: 'MIT',
  grid: { width: 4, height: 4 },
  palette: { a: '#ff0000', b: '#0000ff' },
  anchors: { hand: [3, 0] },
  figure: { variants: { turn: { rows: ['aaaa'], covers: true } } },
  groups: {
    body: { at: [0, 1], rows: ['aa'], variants: { wide: ['aaaa'] } },
    arm: { at: [2, 0], rows: ['a'], variants: { up: ['b'], hold: ['b'] } },
  },
  parts: { held: { hammer: { anchor: 'hand', pivot: [0, 0], rows: ['b'] } } },
  motions: {
    wave: { fps: 4, loop: true, frames: [{ swap: { arm: 'up' } }, { swap: { arm: 'base' } }] },
    spin: { fps: 4, loop: true, frames: [{ swap: { figure: 'turn' } }, {}] },
    duck: { fps: 4, loop: true, frames: [{ hide: ['arm', 'body'] }, {}] },
  },
  states: { idle: 'wave' },
})

function load(css: string): { pack: Pack; rules: readonly Rule[] } {
  const result = loadPack({ json, css })
  if (!result.ok) throw new Error(JSON.stringify(result.errors))
  return result
}

// pack.css cannot name a motion that the pack does not have, so a weighted pool of such names comes in as a rule by hand.
function parseTricks(text: string): Rule[] {
  const tricks = Object.fromEntries(
    text
      .split(',')
      .map(item => item.trim().split(' '))
      .map(([n, w]) => [n!, Number(w)]),
  )
  return [
    { selector: { attrs: {}, event: null }, specificity: 0, set: { pose: {}, lock: [], tricks }, at: { line: 1, column: 1 }, places: {} },
  ]
}

const tags = (fields: Partial<Tags>): Tags => ({ role: null, state: 'idle', parts: {}, ...fields })

function row(fields: Partial<AgentRow>): AgentRow {
  return {
    id: 'a1',
    description: 'd',
    type: 'general-purpose',
    model: 'm',
    parentId: null,
    isTeammate: false,
    // Past its entrance, idle since -10 s.
    status: 'waiting',
    statusAt: -10_000,
    startedAt: -10_000,
    endedAt: null,
    ...fields,
  }
}

describe('styleOf: the cascade', () => {
  test('a more specific rule wins per channel; the others keep their values', () => {
    const { pack, rules } = load(':root { body: wide; arm: up; } [role=builder] { arm: hold; }')
    expect(styleOf(pack, rules, tags({ role: 'builder' })).pose).toEqual({ body: 'wide', arm: 'hold' })
    expect(styleOf(pack, rules, tags({ role: 'tester' })).pose).toEqual({ body: 'wide', arm: 'up' })
  })

  test('on a tie the later rule wins, as in CSS', () => {
    const { pack, rules } = load('[role=builder] { arm: up; } [held=hammer] { arm: hold; }')
    expect(styleOf(pack, rules, tags({ role: 'builder', parts: { held: 'hammer' } })).pose.arm).toBe('hold')
  })

  test('a lock keeps the value of the rule that locks, over a more specific rule', () => {
    const { pack, rules } = load('[held=hammer] { arm: hold; lock: arm; } [held=hammer][role=builder] { arm: up; }')
    const style = styleOf(pack, rules, tags({ role: 'builder', parts: { held: 'hammer' } }))
    expect([style.pose.arm, [...style.locks]]).toEqual(['hold', ['arm']])
  })

  test('play: pack.css beats states in pack.json, which beat the defaults; :root beats the defaults too', () => {
    expect(styleOf(load('').pack, [], tags({})).play).toBe('wave')
    const root = load(':root { play: spin; }')
    expect(styleOf(root.pack, root.rules, tags({ state: 'working' })).play).toBe('spin')
    expect(styleOf(root.pack, root.rules, tags({ state: 'idle' })).play).toBe('wave')
    const { pack, rules } = load('[state=idle] { play: spin; }')
    expect(styleOf(pack, rules, tags({})).play).toBe('spin')
    expect(styleOf(pack, rules, tags({ state: 'working' })).play).toBe('walk')
    expect(styleOf(pack, rules, tags({ state: 'finished' })).play).toBeNull()
  })

  test('tricks add their weights; once is kept for each event; trick-every for the agent', () => {
    const { pack, rules } = load(`
      :root { tricks: wave 1, spin 2; trick-every: 5s 9s; }
      [role=builder] { tricks: wave 3; }
      :finished { once: spin; }
      [role=builder]:finished { once: wave; }
      :failed { once: spin; }
    `)
    const style = styleOf(pack, rules, tags({ role: 'builder' }))
    expect([style.tricks, style.once, style.trickEvery]).toEqual([
      { wave: 4, spin: 2 },
      { finished: { wave: 1 }, failed: { spin: 1 } },
      [5000, 9000],
    ])
  })
})

function look(css: string, fields: Partial<Look> = {}): Look {
  return { ...load(css), role: null, parts: {}, ...fields }
}

test('a motion name that is also an Object member is a plain name', () => {
  const { pack } = load('')
  const style = styleOf(pack, parseTricks('constructor 2, toString 3'), tags({}))
  expect(style.tricks).toEqual({ constructor: 2, toString: 3 })
})

describe('characterPose with rules', () => {
  test('the base pose stays under the motion, and the motion swaps over it', () => {
    const at0 = characterPose(look(':root { body: wide; }'), row({}), 0, 'full').pose.body?.swap
    const at1 = characterPose(look(':root { body: wide; }'), row({}), 250, 'full').pose.body?.swap
    expect([at0, at1]).toEqual([
      { body: 'wide', arm: 'up' },
      { body: 'wide', arm: 'base' },
    ])
  })

  test('off mode draws the base pose, with no motion', () => {
    const pose = characterPose(look('[role=builder] { arm: hold; }', { role: 'builder' }), row({}), 0, 'off')
    expect([pose.key, pose.pose.body?.swap, pose.nextAt]).toEqual(['builder:idle', { arm: 'hold' }, null])
  })

  test('a frame does not change a locked channel, nor cover a locked node', () => {
    const held = look('[held=hammer] { arm: hold; lock: arm; } [held=hammer][state=idle] { play: spin; }', { parts: { held: 'hammer' } })
    expect(characterPose({ ...held }, row({}), 0, 'full').pose.body?.swap).toEqual({ arm: 'hold' })
    const waving = look('[held=hammer] { arm: hold; lock: arm; }', { parts: { held: 'hammer' } })
    expect(characterPose(waving, row({}), 0, 'full').pose.body?.swap).toEqual({ arm: 'hold' })
  })

  test('a lock on a slot keeps its part: no covering frame, no swap from the part motion', () => {
    const held = look('[held=hammer] { lock: held; } [held=hammer][state=idle] { play: spin; }', { parts: { held: 'hammer' } })
    expect(characterPose(held, row({}), 0, 'full').pose.body?.swap).toEqual({})
  })

  test('a frame cannot hide a locked node, nor a node that a locked node is on', () => {
    const held = look('[held=hammer] { arm: hold; lock: arm; } [held=hammer][state=idle] { play: duck; }', { parts: { held: 'hammer' } })
    expect(characterPose(held, row({}), 0, 'full').pose.body?.hide).toEqual(['body'])
  })

  test('off mode still wakes at the end of the entrance when the pose changes then', () => {
    const entering = look('[state=entering] { arm: up; }')
    expect(characterPose(entering, row({ status: 'running', startedAt: 0, statusAt: 0 }), 100, 'off').nextAt).toBe(1500)
  })

  test('the role is in the key, so two roles never share a cached image', () => {
    const a = characterPose(look('', { role: 'builder' }), row({}), 0, 'full').key
    const b = characterPose(look('', { role: 'tester' }), row({}), 0, 'full').key
    expect(a).not.toBe(b)
  })
})

describe('frameAt with repeat', () => {
  const motion = { fps: 4, loop: true, frames: [{ repeat: 3 }, {}] }

  test('a frame holds for its ticks, and the next change is at the end of them', () => {
    expect([0, 749, 750, 999, 1000].map(ms => frameAt(motion, ms))).toEqual([
      { index: 0, nextAt: 750 },
      { index: 0, nextAt: 750 },
      { index: 1, nextAt: 1000 },
      { index: 1, nextAt: 1000 },
      { index: 0, nextAt: 1750 },
    ])
  })

  test('a one-shot motion holds its last frame from its start', () => {
    const once = { ...motion, loop: false }
    expect([frameAt(once, 500), frameAt(once, 750), frameAt(once, 60_000)]).toEqual([
      { index: 0, nextAt: 750 },
      { index: 1, nextAt: null },
      { index: 1, nextAt: null },
    ])
  })
})

test('a pack over the size limits fails before it is parsed', () => {
  expect(loadPack({ json, css: ' '.repeat(MAX_PACK_BYTES) }).ok).toBe(false)
  expect(loadPack({ json: json + ' '.repeat(MAX_PACK_BYTES) }).ok).toBe(false)
  expect(loadPack({ json, css: ' '.repeat(MAX_CSS_CHARS + 1) })).toEqual({
    ok: false,
    errors: [{ path: 'pack.css', message: `has ${MAX_CSS_CHARS + 1} characters; the limit is ${MAX_CSS_CHARS}` }],
  })
})
