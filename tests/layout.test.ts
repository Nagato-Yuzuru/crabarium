import { describe, expect, test } from 'claude-code/testing'

import type { AgentBoard, AgentRow } from '../hooks/core/agents'
import { halve } from '../hooks/core/pack/pack'
import { initialSession } from '../hooks/core/session'
import { FINISHED_TREES, formatDuration, header, LINGER_MS, paneLayout, shortModel, stepsFor } from '../hooks/view/layout'
import type { PaneLayout } from '../hooks/view/layout'

function row(id: string, fields: Partial<AgentRow> = {}): AgentRow {
  return {
    id,
    description: `task ${id}`,
    type: 'Explore',
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

function ended(id: string, status: 'completed' | 'failed' | 'killed', at: number, fields: Partial<AgentRow> = {}): AgentRow {
  return row(id, { status, statusAt: at, endedAt: at, ...fields })
}

function layout(rows: readonly AgentRow[], now = 10_000, columns = 96): PaneLayout {
  const board: AgentBoard = { now, rows }
  return paneLayout(board, initialSession, now, columns, true)
}

describe('stepsFor', () => {
  // Each block shows from the exact column count in STEP and goes one column below it.
  for (const [columns, steps] of [
    [64, { cards: true, small: true, character: true }],
    [63, { cards: false, small: true, character: true }],
    [56, { cards: false, small: true, character: true }],
    [55, { cards: false, small: false, character: true }],
    [48, { cards: false, small: false, character: true }],
    [47, { cards: false, small: false, character: false }],
  ] as const) {
    test(`${columns} columns`, () => {
      expect(stepsFor(columns, true)).toEqual(steps)
    })
  }

  test('a surface without Rasters shows no character at any width', () => {
    expect(stepsFor(200, false)).toEqual({ cards: true, small: false, character: false })
  })
})

describe('header', () => {
  test('shows unknown values as a dash and the tokens as unknown until the usage figures exist', () => {
    expect(header(initialSession)).toEqual({
      model: '—',
      context: '—',
      stats: [
        { label: 'cost', value: null },
        { label: 'tokens', value: null },
        { label: 'time', value: null },
      ],
    })
  })

  test('shows the short model, the rounded context, the cost, and the time from the session start to the last read', () => {
    const session = { model: 'claude-opus-5-5', contextPercent: 41.6, costUsd: 0.005, startedAt: 1000, readAt: 725_000 }
    expect(header(session)).toEqual({
      model: 'opus-5-5',
      context: '42%',
      stats: [
        { label: 'cost', value: '$0.01' },
        { label: 'tokens', value: null },
        { label: 'time', value: '12m 04s' },
      ],
    })
  })
})

describe('formatDuration', () => {
  test('shows seconds, then minutes and seconds, then hours and minutes', () => {
    const cases = [
      [null, '—'],
      [0, '0s'],
      [59_999, '59s'],
      [60_000, '1m 00s'],
      [3_599_999, '59m 59s'],
      [3_600_000, '1h 00m'],
      [3_660_000, '1h 01m'],
    ] as const
    expect(cases.map(([ms]) => formatDuration(ms))).toEqual(cases.map(([, text]) => text))
  })
})

describe('shortModel', () => {
  test('drops the claude- prefix and keeps any other id whole', () => {
    expect([shortModel('claude-sonnet-5-5'), shortModel('us.anthropic.claude-sonnet-5-5')]).toEqual([
      'sonnet-5-5',
      'us.anthropic.claude-sonnet-5-5',
    ])
  })
})

describe('paneLayout groups', () => {
  test('a pane with no agents has no groups', () => {
    expect(layout([]).groups).toEqual([])
  })

  test('a subagent hangs under the agent that spawned it, and a row whose parent is unknown is a root', () => {
    const l = layout([row('a1'), row('b1', { parentId: 'a1' }), row('o1', { parentId: 'gone' })])
    const running = l.groups[0]!
    expect(running.title).toBe('Running')
    expect(running.trees.map(t => [t.root.id, t.children.map(c => c.id)])).toEqual([
      ['a1', ['b1']],
      ['o1', []],
    ])
    expect(running.agents).toBe(3)
  })

  test('a resume that makes the parent ids a cycle keeps every agent: the edge that closes the cycle is dropped', () => {
    // a1 spawned a2, then a2 resumed a1: the resume moves a1 to the end, with a2 as its parent.
    const l = layout([row('a2', { parentId: 'a1' }), row('a1', { parentId: 'a2' })])
    expect(l.groups[0]!.trees.map(t => [t.root.id, t.children.map(c => c.id)])).toEqual([['a1', ['a2']]])
    expect(l.groups[0]!.agents).toBe(2)
  })

  test('a row that names itself as its parent is a root', () => {
    expect(layout([row('a1', { parentId: 'a1' })]).groups[0]!.trees.map(t => t.root.id)).toEqual(['a1'])
  })

  test('Running counts the live agents only; a folded ended subagent does not count', () => {
    const l = layout([row('a1'), ended('b1', 'completed', 100, { parentId: 'a1' }), ended('b2', 'failed', 100, { parentId: 'a1' })])
    expect(l.groups[0]!.agents).toBe(1)
  })

  test('a tree stays in Running while any agent in it is live', () => {
    const l = layout([ended('a1', 'completed', 100), row('b1', { parentId: 'a1' })])
    expect(l.groups.map(g => [g.title, g.trees.map(t => t.root.id)])).toEqual([['Running', ['a1']]])
  })

  test('Finished holds the ended trees, newest end first, and folds the oldest past the limit', () => {
    const rows = Array.from({ length: FINISHED_TREES + 2 }, (_, i) => ended(`f${i}`, 'completed', 100 * i))
    // f0 ended first, but its subagent ended last: the tree's end is its last agent's end.
    rows.push(ended('c0', 'completed', 9000, { parentId: 'f0' }))
    const l = layout(rows)
    const finished = l.groups[0]!
    expect(finished.title).toBe('Finished')
    expect(finished.trees.map(t => t.root.id)).toEqual(['f0', 'f6', 'f5', 'f4', 'f3'])
    expect(l.earlier).toBe(2)
    expect(finished.agents).toBe(FINISHED_TREES + 3)
  })

  test('a finished tree shows its main-loop agent alone, with the subagent count on line 2', () => {
    const l = layout([
      ended('f1', 'completed', 500, { startedAt: 0 }),
      ended('c1', 'completed', 400, { parentId: 'f1' }),
      ended('c2', 'failed', 450, { parentId: 'c1' }),
    ])
    const tree = l.groups[0]!.trees[0]!
    expect([tree.children, tree.folded]).toEqual([[], null])
    expect(tree.root.detail).toBe('0s · 2 subagents · Explore · haiku-5-5')
  })
})

describe('paneLayout subagents', () => {
  test('an ended subagent stays for LINGER_MS after its end, then folds', () => {
    const rows = [row('a1'), ended('b1', 'completed', 1000, { parentId: 'a1' })]
    expect(layout(rows, 1000 + LINGER_MS - 1).groups[0]!.trees[0]!.children.map(c => c.id)).toEqual(['b1'])
    const later = layout(rows, 1000 + LINGER_MS).groups[0]!.trees[0]!
    expect([later.children, later.folded]).toEqual([[], { completed: 1, failed: 0, killed: 0, agents: 1 }])
  })

  test('the folded line counts each result at every depth, so a nested failure still shows', () => {
    const rows = [
      row('a1'),
      ended('b1', 'completed', 100, { parentId: 'a1' }),
      ended('b2', 'completed', 100, { parentId: 'a1' }),
      ended('d1', 'failed', 90, { parentId: 'b1' }),
      ended('d2', 'killed', 90, { parentId: 'b1' }),
    ]
    expect(layout(rows).groups[0]!.trees[0]!.folded).toEqual({ completed: 2, failed: 1, killed: 1, agents: 4 })
  })

  test('agents below a subagent fold into a count on its line 2, after the duration', () => {
    const rows = [
      row('a1'),
      row('b1', { parentId: 'a1', startedAt: 4000 }),
      row('d1', { parentId: 'b1' }),
      ended('d2', 'completed', 100, { parentId: 'b1' }),
      row('e1', { parentId: 'd1' }),
    ]
    const tree = layout(rows).groups[0]!.trees[0]!
    expect(tree.children.map(c => c.id)).toEqual(['b1'])
    expect(tree.children[0]!.detail).toBe('6s · +3 nested, 2 running · Explore · haiku-5-5')
  })

  test('a subagent with no running nested agent says only how many there are; idle and waiting do not run', () => {
    const rows = [
      row('a1'),
      row('b1', { parentId: 'a1' }),
      ended('d1', 'completed', 100, { parentId: 'b1' }),
      row('d2', { parentId: 'b1', status: 'idle' }),
      row('d3', { parentId: 'b1', status: 'waiting' }),
    ]
    expect(layout(rows).groups[0]!.trees[0]!.children[0]!.detail).toBe('10s · +3 nested · Explore · haiku-5-5')
  })
})

describe('paneLayout characters', () => {
  const rows = [row('a1'), row('b1', { parentId: 'a1' }), ended('f1', 'completed', 100)]

  test('a main-loop agent has the large character and a subagent the small one', () => {
    expect(layout(rows, 10_000, 56).characters).toEqual([
      { id: 'a1', size: 'full' },
      { id: 'b1', size: 'small' },
      { id: 'f1', size: 'full' },
    ])
  })

  test('below the small step only the main-loop agents keep a character', () => {
    const l = layout(rows, 10_000, 55)
    expect(l.characters.map(c => c.id)).toEqual(['a1', 'f1'])
    expect(l.groups[0]!.trees[0]!.children[0]!.character).toBeNull()
  })

  test('below the character step no character shows, so nothing animates', () => {
    expect(layout(rows, 10_000, 47).characters).toEqual([])
  })
})

describe('halve', () => {
  const R = 0xff0000
  const B = 0x0000ff

  test('a block with two or more opaque pixels takes its most common color; one pixel is not enough', () => {
    // prettier-ignore
    const grid = { width: 6, height: 2, pixels: [
      R, null, R, R, B, R,
      null, null, B, null, R, B,
    ] }
    expect(halve(grid)).toEqual({ width: 3, height: 1, pixels: [null, R, B] })
  })

  test('an odd side counts the missing pixels as transparent', () => {
    expect(halve({ width: 3, height: 1, pixels: [R, R, R] })).toEqual({ width: 2, height: 1, pixels: [R, null] })
  })
})
