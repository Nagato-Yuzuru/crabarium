import { describe, expect, test } from 'claude-code/testing'

import type { AgentRow } from '../hooks/core/agents.ts'
import { characterPose } from '../hooks/core/character.ts'
import type { Look, MotionMode } from '../hooks/core/character.ts'
import { loadPack } from '../hooks/core/pack/load.ts'
import { trackOneFigures } from '../skills/pack-authoring/scripts/sheet.ts'

// An arm with variants, a cover over the whole figure, and a hammer. `spin`,
// `wave`, and `drop` are 500 ms long; `nod` moves the whole figure; `still`
// never changes.
const json = JSON.stringify({
  formatVersion: 1,
  name: 'tracks',
  author: 'test',
  license: 'MIT',
  grid: { width: 4, height: 4 },
  palette: { a: '#ff0000', b: '#0000ff' },
  anchors: { hand: [3, 0] },
  figure: { variants: { turn: { rows: ['aaaa'], covers: true } } },
  groups: { arm: { at: [2, 0], rows: ['a'], variants: { up: ['b'], hold: ['b'] } } },
  parts: { held: { hammer: { anchor: 'hand', pivot: [0, 0], rows: ['b'] } } },
  motions: {
    wave: { fps: 4, loop: false, frames: [{ swap: { arm: 'up' } }, { swap: { arm: 'base' } }] },
    spin: { fps: 4, loop: false, frames: [{ swap: { figure: 'turn' } }, {}] },
    nod: { fps: 4, loop: true, frames: [{ offset: { '*': [0, 1] } }] },
    drop: { fps: 4, loop: false, frames: [{ hide: ['held'] }, {}] },
    still: { fps: 1, loop: true, frames: [{}] },
  },
})

function look(css: string, fields: Partial<Look> = {}): Look {
  const result = loadPack({ json, css })
  if (!result.ok) throw new Error(JSON.stringify(result.errors))
  return { pack: result.pack, rules: result.rules, role: null, parts: {}, ...fields }
}

function row(fields: Partial<AgentRow> = {}): AgentRow {
  return {
    id: 'a1',
    description: 'd',
    type: 'general-purpose',
    model: 'm',
    parentId: null,
    isTeammate: false,
    // Working since 0, past its entrance from 1.5 s.
    status: 'running',
    statusAt: 0,
    startedAt: 0,
    endedAt: null,
    ...fields,
  }
}

// The track 1 motion name at each 10 ms from `from` to `to`, or '' when track 1 is clear.
function trackOne(at: Look, agent: AgentRow, from: number, to: number, mode: MotionMode = 'full'): { t: number; shot: string }[] {
  const out: { t: number; shot: string }[] = []
  for (let t = from; t < to; t += 10) {
    const shot = /\|1:([^:|]+):/.exec(characterPose(at, agent, t, mode).key)?.[1] ?? ''
    out.push({ t, shot })
  }
  return out
}

// The times at which a trick starts.
function starts(samples: readonly { t: number; shot: string }[]): number[] {
  return samples.filter((s, i) => s.shot !== '' && (i === 0 || samples[i - 1]!.shot === '')).map(s => s.t)
}

describe('track 1: once on an event', () => {
  const finished = row({ status: 'completed', statusAt: 1000, endedAt: 1000 })

  test('the event plays its once motion from the state change, then track 1 clears', () => {
    const at = look(':finished { once: spin; }')
    expect(characterPose(at, finished, 1100, 'full').pose.body?.swap).toEqual({ figure: 'turn' })
    expect(characterPose(at, finished, 1100, 'full').nextAt).toBe(1250)
    expect(characterPose(at, finished, 1300, 'full').key).toContain('|1:spin:1')
    expect(characterPose(at, finished, 1300, 'full').nextAt).toBe(1500)
    expect(characterPose(at, finished, 1500, 'full').key).not.toContain('|1:')
    expect(characterPose(at, finished, 1500, 'full').nextAt).toBeNull()
  })

  test('only the event of the state plays', () => {
    const at = look(':failed { once: spin; }')
    expect(characterPose(at, finished, 1100, 'full').key).not.toContain('|1:')
    expect(characterPose(at, row({ status: 'failed', statusAt: 1000, endedAt: 1000 }), 1100, 'full').key).toContain('|1:spin:0')
  })

  test('reduced and off motion play no track 1', () => {
    const at = look(':finished { once: spin; }')
    expect(characterPose(at, finished, 1100, 'reduced').key).not.toContain('|1:')
    expect(characterPose(at, finished, 1100, 'off').key).not.toContain('|1:')
  })
})

describe('track 1: tricks', () => {
  test('two tricks are from the shortest to the longest idle-every time apart, and the first is after the shortest', () => {
    const shots = trackOne(look(':root { tricks: spin; idle-every: 2s 4s; }'), row(), 0, 120_000)
    const times = starts(shots)
    expect(times.length).toBeGreaterThan(25)
    expect(times[0]).toBeGreaterThanOrEqual(2000)
    const gaps = times.slice(1).map((t, i) => t - times[i]!)
    expect(gaps.every(gap => gap >= 1990 && gap <= 4010)).toBe(true)
    // The jitter makes the gaps differ.
    expect(new Set(gaps).size).toBeGreaterThan(3)
  })

  test('a trick plays once through: 500 ms for spin', () => {
    const shots = trackOne(look(':root { tricks: spin; idle-every: 2s 4s; }'), row(), 0, 20_000)
    const first = starts(shots)[0]!
    expect(shots.filter(s => s.t >= first && s.t < first + 1000 && s.shot === 'spin')).toHaveLength(50)
  })

  test('the weights pick among the tricks', () => {
    const shots = trackOne(look(':root { tricks: spin 1, wave 1; idle-every: 1s; }'), row(), 0, 60_000)
    expect(new Set(shots.map(s => s.shot))).toEqual(new Set(['', 'spin', 'wave']))
  })

  test('two agents do not trick at the same times', () => {
    const at = look(':root { tricks: spin; idle-every: 2s 4s; }')
    expect(starts(trackOne(at, row({ id: 'a1' }), 0, 30_000))).not.toEqual(starts(trackOne(at, row({ id: 'b2' }), 0, 30_000)))
  })

  test('a trick that uses a locked channel is not in the pool', () => {
    const at = look('[held=hammer] { arm: hold; lock: arm; } :root { tricks: wave; idle-every: 1s; }')
    expect(trackOne({ ...at, parts: { held: 'hammer' } }, row(), 0, 20_000).every(s => s.shot === '')).toBe(true)
    expect(trackOne(at, row(), 0, 20_000).some(s => s.shot === 'wave')).toBe(true)
  })

  test('the tricks of a state play only in that state', () => {
    const at = look('[state=idle] { tricks: spin; idle-every: 1s; }')
    expect(trackOne(at, row(), 0, 20_000).every(s => s.shot === '')).toBe(true)
    expect(trackOne(at, row({ status: 'waiting' }), 0, 20_000).some(s => s.shot === 'spin')).toBe(true)
  })

  test('nextAt is exact: the pose does not change before it, and a trick starts at it', () => {
    const at = look(':root { tricks: spin; idle-every: 2s 4s; }')
    const agent = row()
    for (let t = 0; t < 30_000; t += 370) {
      const { key, nextAt } = characterPose(at, agent, t, 'full')
      expect(nextAt).not.toBeNull()
      expect(characterPose(at, agent, nextAt! - 1, 'full').key).toBe(key)
      expect(characterPose(at, agent, nextAt!, 'full').key).not.toBe(key)
    }
  })
})

test('track 1 goes over track 0 per channel: offsets add, and the swaps of both stay', () => {
  const at = look(':root { play: nod; tricks: spin; idle-every: 1s; }')
  const agent = row({ status: 'waiting' })
  const t = starts(trackOne(at, agent, 0, 10_000))[0]!
  expect(characterPose(at, agent, t, 'full').pose.body).toEqual({
    offset: { '*': [0, 1] },
    swap: { figure: 'turn' },
    hide: [],
    palette: {},
  })
  const waving = look(':root { play: nod; tricks: wave; idle-every: 1s; arm: hold; }')
  const w = starts(trackOne(waving, agent, 0, 10_000))[0]!
  expect(characterPose(waving, agent, w, 'full').pose.body?.swap).toEqual({ arm: 'up' })
})

test('the contact sheet shows each track 1 motion that can play, frame by frame, on the pose of a state that plays it', () => {
  const at = look(`
    [state=finished] { arm: hold; }
    [state=working] { arm: hold; lock: arm; }
    :root { tricks: wave; idle-every: 1s; }
    :finished { once: spin; }
    :click { once: spin; }
  `)
  const rows = trackOneFigures(at.pack, at.rules)
  expect(rows.map(r => [r.state, r.motion, r.figures.map(f => f.pose.body?.swap)])).toEqual([
    ['entering trick', 'wave', [{ arm: 'up' }, { arm: 'base' }]],
    ['finished trick', 'wave', [{ arm: 'up' }, { arm: 'base' }]],
    ['finished once', 'spin', [{ arm: 'hold', figure: 'turn' }, { arm: 'hold' }]],
  ])
  // Tricks with no idle-every never play, so the sheet does not show them.
  const never = look(':root { tricks: wave; }')
  expect(trackOneFigures(never.pack, never.rules)).toEqual([])
})

describe('track 1: regressions', () => {
  test('a lock on a slot keeps a frame from hiding the part, on both tracks', () => {
    const hammer = { parts: { held: 'hammer' } }
    const tricks = look('[held=hammer] { lock: held; } :root { tricks: drop; idle-every: 1s; }', hammer)
    expect(trackOne(tricks, row(), 0, 20_000).every(s => s.shot === '')).toBe(true)
    const loop = look('[held=hammer] { lock: held; } :root { play: drop; }', hammer)
    expect(characterPose(loop, row(), 100, 'full').pose.body?.hide).toEqual([])
  })

  test('the cost of a lock check does not grow with the frame count', () => {
    // Free frames: each hides a node that no lock is on, so a check per frame reads every frame.
    const frames = Array.from({ length: 50_000 }, () => ({ hide: ['tail'] }))
    const big = JSON.parse(json)
    big.groups.tail = { at: [0, 3], rows: ['a'] }
    big.motions.big = { fps: 4, loop: false, frames }
    const result = loadPack({ json: JSON.stringify(big), css: '[held=hammer] { lock: arm; } :root { tricks: big; idle-every: 1000s; }' })
    if (!result.ok) throw new Error(JSON.stringify(result.errors))
    const at: Look = { pack: result.pack, rules: result.rules, role: null, parts: { held: 'hammer' } }
    const begin = performance.now()
    for (let t = 0; t < 2000; t += 1) characterPose(at, row(), t * 100, 'full')
    expect(performance.now() - begin).toBeLessThan(250)
  })

  test('the end of the entrance is a change time when only the tricks of working differ', () => {
    const at = look(':root { play: still; } [state=working] { tricks: spin; idle-every: 1s; }')
    expect(characterPose(at, row(), 100, 'full').nextAt).toBe(1500)
  })

  test('the first trick of working is at least the shortest time after the entrance', () => {
    const at = look('[state=working] { tricks: spin; idle-every: 1s 1.4s; }')
    for (const id of ['a1', 'b2', 'c3', 'd4', 'e5', 'f6', 'g7', 'h8']) {
      expect(starts(trackOne(at, row({ id }), 0, 6000))[0]).toBeGreaterThanOrEqual(2500)
    }
  })

  test('the picks look random for a total weight that is a power of two, and differ between agents', () => {
    const at = look(':root { tricks: spin 1, wave 1; idle-every: 1s; }')
    const picks = (id: string) => {
      const shots = trackOne(at, row({ id }), 0, 400_000)
      return starts(shots).map(t => shots.find(s => s.t === t)!.shot)
    }
    const a = picks('a1')
    const repeats = a.slice(1).filter((p, i) => p === a[i]).length
    expect(repeats / (a.length - 1)).toBeGreaterThan(0.35)
    expect(repeats / (a.length - 1)).toBeLessThan(0.65)
    expect(picks('b2')).not.toEqual(a)
  })

  test('with one idle-every time, two agents that start together do not trick in step', () => {
    const at = look(':root { tricks: spin; idle-every: 5s; }')
    const a = starts(trackOne(at, row({ id: 'a1' }), 0, 30_000))
    const b = starts(trackOne(at, row({ id: 'b2', startedAt: 3, statusAt: 3 }), 0, 30_000))
    expect(b.map((t, i) => Math.abs(t - a[i]!)).some(d => d > 100)).toBe(true)
  })
})
