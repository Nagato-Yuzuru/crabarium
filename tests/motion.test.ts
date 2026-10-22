import { describe, expect, test } from 'claude-code/testing'

import type { AgentRow } from '../hooks/core/agents.ts'
import { characterPose, characterState, ENTER_MS, frameAt } from '../hooks/core/character.ts'
import { BUILTIN_MOTIONS, motionOf } from '../hooks/core/pack/motions.ts'
import { compose, parsePack } from '../hooks/core/pack/pack.ts'
import type { Motion, Pack, Part, Pose } from '../hooks/core/pack/pack.ts'
import { builtinPack } from '../hooks/view/avatar.ts'
import { validPack } from './fixtures/packs.ts'

const RED = 0xff0000
const BLUE = 0x0000ff
const WHITE = 0xffffff
const BLACK = 0x000000

const pack = { ...validPack, groups: { body: { ...validPack.groups.body, variants: { flat: ['aaaa'] } } } } as unknown as Pack
const hat = { hat: 'dot' }

function row(fields: Partial<AgentRow>): AgentRow {
  return {
    id: 'a1',
    description: 'd',
    type: 'general-purpose',
    model: 'claude-haiku-5-5',
    parentId: null,
    isTeammate: false,
    status: 'running',
    statusAt: 0,
    startedAt: 0,
    endedAt: null,
    ...fields,
  }
}

function pixels(pose: Pose, target: Pack = pack): readonly (number | null)[] {
  return compose(target, hat, pose).pixels
}

describe('frame operations', () => {
  test('offset "*" moves the whole character, and the grid clips it', () => {
    // prettier-ignore
    expect(pixels({ body: { offset: { '*': [-1, 0] } } })).toEqual([
      null, BLUE, null, null,
      RED, RED, RED, null,
      null, null, RED, null,
    ])
  })

  test('the offset of a target adds to the offset of "*"', () => {
    // prettier-ignore
    expect(pixels({ body: { offset: { '*': [0, 1], hat: [1, 0] } } })).toEqual([
      null, null, null, null,
      null, null, null, BLUE,
      RED, RED, RED, RED,
    ])
  })

  test('swap draws a variant of the group at the same place', () => {
    // prettier-ignore
    expect(pixels({ body: { swap: { body: 'flat' } } })).toEqual([
      null, null, BLUE, null,
      RED, RED, RED, RED,
      null, null, null, null,
    ])
  })

  test('hide leaves out groups and slots', () => {
    expect(pixels({ body: { hide: ['hat'] } })[2]).toBeNull()
    expect(pixels({ body: { hide: ['body', 'hat'] } }).every(p => p === null)).toBe(true)
  })

  test('palette replaces a color in the pack palette and in each part palette', () => {
    const recolored = pixels({ body: { palette: { a: '#ffffff', c: '#000000' } } })
    expect([recolored[2], recolored[4]]).toEqual([BLACK, WHITE])
  })

  test('a part frame moves, swaps, recolors, and hides the part alone', () => {
    const withVariant: Pack = { ...pack, parts: { hat: { dot: { ...pack.parts!.hat!.dot!, variants: { big: ['cc'] } } } } }
    const moved = pixels({ parts: { hat: { offset: [-1, 0], swap: 'big', palette: { c: '#ffffff' } } } }, withVariant)
    expect(moved.slice(0, 4)).toEqual([null, WHITE, WHITE, null])
    expect(moved.slice(4)).toEqual(pixels({}).slice(4))
    expect(pixels({ parts: { hat: { hide: true } } }, withVariant).slice(0, 4)).toEqual([null, null, null, null])
  })
})

describe('names that Object.prototype also has', () => {
  test('a group and a slot named constructor and toString move as any other', () => {
    const odd = {
      ...pack,
      groups: { constructor: pack.groups.body! },
      parts: { toString: { dot: pack.parts!.hat!.dot! } },
      defaults: { parts: { toString: 'dot' } },
    } as unknown as Pack
    expect(parsePack(odd)).toEqual({ ok: true, pack: odd })
    // The group has no offset in this frame; a plain lookup would read Object.prototype.constructor.
    const moved = compose(odd, { toString: 'dot' }, { body: { offset: { toString: [-1, 0] as const } } }).pixels
    // prettier-ignore
    expect(moved).toEqual([
      null, BLUE, null, null,
      RED, RED, RED, RED,
      RED, null, null, RED,
    ])
  })
})

describe('a part motion', () => {
  const sweep: Part = {
    anchor: 'head',
    pivot: [0, 0],
    rows: ['c'],
    palette: { c: '#0000ff' },
    motion: { fps: 2, loop: true, frames: [{}, { offset: [1, 0] }] },
  }
  const small: Pack = { ...pack, parts: { held: { glass: sweep } } }
  const large: Pack = {
    ...small,
    grid: { width: 8, height: 6 },
    anchors: { head: [5, 3] },
    groups: { body: { at: [0, 4], rows: ['aaaaaaaa'] } },
  }

  test('moves the part the same way on two different bodies, in any state', () => {
    for (const [body, [ax, ay], status] of [
      [small, [2, 0], 'running'],
      [large, [5, 3], 'completed'],
    ] as const) {
      const { pose } = characterPose(body, { held: 'glass' }, row({ status, statusAt: 0 }), 500, 'full')
      const { pixels: drawn, width } = compose(body, { held: 'glass' }, pose)
      expect(drawn[ay * width + ax + 1]).toBe(BLUE)
      expect(drawn.filter(p => p === BLUE)).toHaveLength(1)
    }
  })
})

describe('frameAt', () => {
  const loop: Motion = { fps: 4, loop: true, frames: [{}, {}, {}] }
  const once: Motion = { ...loop, loop: false }

  test('a loop steps at the frame rate and wraps', () => {
    const at = [0, 249, 250, 749, 750, -10].map(ms => frameAt(loop, ms))
    expect(at.map(f => f.index)).toEqual([0, 0, 1, 2, 0, 0])
    expect(at.map(f => f.nextAt)).toEqual([250, 250, 500, 750, 1000, 250])
  })

  test('a one-shot motion holds its last frame, and then it does not change', () => {
    expect([499, 500, 9_999].map(ms => frameAt(once, ms))).toEqual([
      { index: 1, nextAt: 500 },
      { index: 2, nextAt: null },
      { index: 2, nextAt: null },
    ])
  })

  test('the next change is the first whole millisecond of the next frame', () => {
    const six: Motion = { fps: 6, loop: true, frames: [{}, {}] }
    const changes = [0, 167, 334, 500].map(ms => frameAt(six, ms))
    expect(changes.map(f => f.nextAt)).toEqual([167, 334, 500, 667])
    expect(changes.map(f => f.index)).toEqual([0, 1, 0, 1])
    expect(frameAt(six, 166).index).toBe(0)
  })

  test('a loop with one frame does not move', () => {
    expect(frameAt({ fps: 4, loop: true, frames: [{}] }, 1000)).toEqual({ index: 0, nextAt: null })
  })

  test('reduced motion shows the start of a loop and the end of a one-shot motion, and never moves', () => {
    expect([frameAt(loop, 300, 'reduced'), frameAt(once, 0, 'reduced')]).toEqual([
      { index: 0, nextAt: null },
      { index: 2, nextAt: null },
    ])
  })
})

describe('characterState', () => {
  for (const [status, state] of [
    ['pending', 'working'],
    ['running', 'working'],
    ['waiting', 'idle'],
    ['idle', 'idle'],
    ['completed', 'finished'],
    ['failed', 'failed'],
    ['killed', 'failed'],
  ] as const) {
    test(`a ${status} agent after the entrance is ${state}`, () => {
      expect(characterState(row({ status }), ENTER_MS).state).toBe(state)
    })
  }

  test('a live agent is entering until ENTER_MS after the spawn', () => {
    expect(characterState(row({ startedAt: 100 }), 100 + ENTER_MS - 1)).toEqual({ state: 'entering', since: 100 })
    expect(characterState(row({ startedAt: 100 }), 100 + ENTER_MS)).toEqual({ state: 'working', since: 100 })
  })

  test('an agent that ends during the entrance shows how it ended', () => {
    expect(characterState(row({ status: 'failed', statusAt: 50, endedAt: 50 }), 60)).toEqual({ state: 'failed', since: 50 })
  })

  test('an idle motion starts at the status change', () => {
    expect(characterState(row({ status: 'waiting', statusAt: 4000 }), 9000)).toEqual({ state: 'idle', since: 4000 })
  })

  test('an ended motion starts at the end, so a later correction of how it ended does not start it again', () => {
    expect(characterState(row({ status: 'killed', statusAt: 11_000, endedAt: 10_000 }), 12_000)).toEqual({ state: 'failed', since: 10_000 })
  })

  test('a row from a build before statusAt starts its motion at the spawn', () => {
    const old = { ...row({ status: 'waiting', startedAt: 300 }), statusAt: undefined } as unknown as AgentRow
    expect(characterState(old, 9000)).toEqual({ state: 'idle', since: 300 })
  })
})

describe('motions', () => {
  test('the built-in motions pass the pack checks', () => {
    expect(parsePack({ ...validPack, motions: BUILTIN_MOTIONS }).ok).toBe(true)
  })

  test('a state uses the pack motion, then the built-in motion; finished stands still', () => {
    const minimal = builtinPack('minimal').pack
    expect(motionOf(minimal, 'working')).toBe(minimal.motions!.walk!)
    expect(motionOf(minimal, 'failed')).toBe(minimal.motions!.slump!)
    expect(motionOf(minimal, 'idle')).toBe(BUILTIN_MOTIONS.bob!)
    expect(motionOf(minimal, 'finished')).toBeNull()
  })

  test('a states entry can point a state at a built-in motion', () => {
    expect(motionOf({ ...pack, states: { working: 'swing' } }, 'working')).toBe(BUILTIN_MOTIONS.swing!)
  })
})

describe('characterPose', () => {
  const minimal = builtinPack('minimal').pack
  const none = {}

  test('a working character moves at the frame rate of its motion', () => {
    // The walk changes frame each 1000 / 6 ms after the spawn: at 5 000 ms, the next change is at 5 167 ms.
    expect(characterPose(minimal, none, row({}), 5_000, 'full').nextAt).toBe(5_167)
  })

  test('the fail pose plays once from the status change and then stands still', () => {
    const failed = row({ status: 'failed', statusAt: 10_000, endedAt: 10_000 })
    expect(characterPose(minimal, none, failed, 10_100, 'full')).toEqual(expect.objectContaining({ key: 'failed:0', nextAt: 10_250 }))
    expect(characterPose(minimal, none, failed, 60_000, 'full')).toEqual(expect.objectContaining({ key: 'failed:1', nextAt: null }))
  })

  test('the end of the entrance is a frame change only when working has another motion', () => {
    const still = { ...minimal, states: { entering: 'bob', working: 'bob' } }
    const other = { ...minimal, states: { entering: 'bob', working: 'swing' } }
    // Reduced motion: only the end of the entrance can change the pose.
    expect(characterPose(still, none, row({}), 100, 'reduced').nextAt).toBeNull()
    expect(characterPose(other, none, row({}), 100, 'reduced').nextAt).toBe(ENTER_MS)
  })

  test('a finished character stands still and draws the plain character', () => {
    const finished = characterPose(minimal, none, row({ status: 'completed' }), 5_000, 'full')
    expect(finished).toEqual({ key: 'still', pose: {}, nextAt: null })
  })

  test('off mode draws the plain character in every state', () => {
    expect(characterPose(minimal, none, row({ status: 'failed' }), 5_000, 'off')).toEqual({ key: 'still', pose: {}, nextAt: null })
  })

  test('reduced mode keeps the fail pose but never moves', () => {
    const pose = characterPose(minimal, none, row({ status: 'failed', statusAt: 4_900, endedAt: 4_900 }), 5_000, 'reduced')
    expect([pose.key, pose.nextAt]).toEqual(['failed:1', null])
  })

  test('each frame of each minimal motion draws different pixels than the plain character', () => {
    const plain = compose(minimal, none).pixels
    for (const motion of Object.values(minimal.motions!)) {
      for (const frame of motion.frames) expect(compose(minimal, none, { body: frame }).pixels).not.toEqual(plain)
    }
  })
})
