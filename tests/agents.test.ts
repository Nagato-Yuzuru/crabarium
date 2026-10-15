import { describe, expect, test } from 'claude-code/testing'

import { listedEvent } from '../hooks/collect'
import { durationMs, initialAgents, reduceAgents } from '../hooks/core/agents'
import type { AgentBoard, AgentEvent } from '../hooks/core/agents'
import { agentGroups, formatDuration } from '../hooks/view/pane'

function spawned(id: string, at: number, fields: Partial<Extract<AgentEvent, { kind: 'agent-spawned' }>> = {}): AgentEvent {
  return {
    kind: 'agent-spawned',
    id,
    description: `task ${id}`,
    type: 'general-purpose',
    model: 'claude-haiku-5-5',
    parentId: null,
    isTeammate: false,
    at,
    ...fields,
  }
}

function listed(at: number, statuses: Record<string, AgentBoard['rows'][number]['status']>): AgentEvent {
  return { kind: 'agents-listed', statuses: Object.entries(statuses).map(([id, status]) => ({ id, status })), at }
}

function run(...events: AgentEvent[]): AgentBoard {
  return events.reduce(reduceAgents, initialAgents)
}

describe('reduceAgents', () => {
  test('a spawn adds a running row that starts at the spawn time', () => {
    expect(run(spawned('a1', 1000))).toEqual({
      now: 1000,
      rows: [
        {
          id: 'a1',
          description: 'task a1',
          type: 'general-purpose',
          model: 'claude-haiku-5-5',
          parentId: null,
          isTeammate: false,
          status: 'running',
          statusAt: 1000,
          startedAt: 1000,
          endedAt: null,
        },
      ],
    })
  })

  test('a nested spawn keeps the id of the agent that spawned it', () => {
    const board = run(spawned('a1', 0), spawned('a2', 10, { parentId: 'a1' }))
    expect(board.rows.map(r => [r.id, r.parentId])).toEqual([
      ['a1', null],
      ['a2', 'a1'],
    ])
  })

  test('a list read changes the status and records the end time of an ended agent', () => {
    const board = run(spawned('a1', 0), spawned('a2', 0), listed(500, { a1: 'waiting', a2: 'failed' }))
    expect(board.rows.map(r => [r.status, r.endedAt])).toEqual([
      ['waiting', null],
      ['failed', 500],
    ])
    expect(board.now).toBe(500)
  })

  test('a list read ignores agents the pane does not show', () => {
    const before = run(spawned('a1', 0), listed(100, { a1: 'completed' }))
    expect(reduceAgents(before, listed(200, { other: 'running' }))).toBe(before)
  })

  test('a list read with no live row and no change keeps the same object, so readers do not redraw', () => {
    expect(reduceAgents(initialAgents, listed(100, {}))).toBe(initialAgents)
  })

  test('a list read moves the time while a row is live, so durations go on', () => {
    const board = run(spawned('a1', 0), listed(3000, { a1: 'running' }))
    expect(board.now).toBe(3000)
    expect(durationMs(board.rows[0]!, board.now)).toBe(3000)
  })

  for (const [reason, status] of [
    ['answer', 'completed'],
    ['aborted', 'killed'],
    ['refusal', 'failed'],
    ['error', 'failed'],
  ] as const) {
    test(`a turn end with reason ${reason} ends the subagent as ${status}`, () => {
      const board = run(spawned('a1', 0), { kind: 'agent-turn-ended', id: 'a1', reason, at: 4000 })
      expect(board.rows[0]).toEqual(expect.objectContaining({ status, endedAt: 4000 }))
    })
  }

  test('each status change records its time; a list read with the same status does not', () => {
    const board = run(spawned('a1', 0), listed(100, { a1: 'running' }), listed(200, { a1: 'waiting' }), listed(300, { a1: 'waiting' }))
    expect(board.rows[0]!.statusAt).toBe(200)
  })

  test('a turn end does not end a teammate: it only goes idle', () => {
    const before = run(spawned('t1', 0, { isTeammate: true }))
    expect(reduceAgents(before, { kind: 'agent-turn-ended', id: 't1', reason: 'answer', at: 10 })).toBe(before)
  })

  test('a list status after the turn end does not reopen the row, but it can correct how it ended', () => {
    const ended = run(spawned('a1', 0), { kind: 'agent-turn-ended', id: 'a1', reason: 'answer', at: 100 })
    expect(reduceAgents(ended, listed(200, { a1: 'running' }))).toBe(ended)
    const killed = reduceAgents(ended, listed(200, { a1: 'killed' }))
    expect(killed.rows[0]).toEqual(expect.objectContaining({ status: 'killed', endedAt: 100 }))
  })

  test('a resume spawn of an ended agent reopens it as the newest row', () => {
    const board = run(
      spawned('a1', 0),
      spawned('a2', 5),
      { kind: 'agent-turn-ended', id: 'a1', reason: 'answer', at: 10 },
      spawned('a1', 20),
    )
    expect(board.rows.map(r => [r.id, r.status, r.startedAt, r.endedAt])).toEqual([
      ['a2', 'running', 5, null],
      ['a1', 'running', 20, null],
    ])
  })
})

describe('listedEvent', () => {
  test('keeps only the id and the status of each listed agent', () => {
    const event = listedEvent([{ id: 'a1', description: 'd', type: 'Explore', status: 'idle', name: 'n' }], 7)
    expect(event).toEqual({ kind: 'agents-listed', statuses: [{ id: 'a1', status: 'idle' }], at: 7 })
  })
})

describe('durationMs', () => {
  test('is unknown before the first time read', () => {
    const row = run(spawned('a1', 0)).rows[0]!
    expect(durationMs(row, null)).toBeNull()
  })

  test('stops at the end time of an ended agent', () => {
    const board = run(spawned('a1', 1000), { kind: 'agent-turn-ended', id: 'a1', reason: 'answer', at: 6000 })
    expect(durationMs(board.rows[0]!, 99_000)).toBe(5000)
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

describe('agentGroups', () => {
  test('leaves out empty groups', () => {
    expect(agentGroups(initialAgents)).toEqual([])
  })

  test('puts live agents under Running and ended ones under Finished, each in spawn order', () => {
    const board = run(spawned('a1', 0), spawned('a2', 0), spawned('a3', 0), listed(2000, { a1: 'completed', a2: 'idle', a3: 'killed' }))
    expect(agentGroups(board).map(g => [g.title, g.lines.map(l => `${l.id} ${l.status} ${l.duration}`)])).toEqual([
      ['Running', ['a2 idle 2s']],
      ['Finished', ['a1 completed 2s', 'a3 killed 2s']],
    ])
  })
})
