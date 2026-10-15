// The subagents as the pane shows them. Pure: no engine calls; times come in
// with the events.
import type { AgentBoard, AgentRow, AgentStatus } from '../../types'

export type { AgentBoard, AgentRow, AgentStatus }

/** How a turn ended, as `turn.complete` gives it. */
export type TurnEndReason = 'answer' | 'aborted' | 'refusal' | 'error'

export type AgentEvent =
  | {
      kind: 'agent-spawned'
      id: string
      description: string
      type: string
      model: string
      parentId: string | null
      isTeammate: boolean
      at: number
    }
  | { kind: 'agents-listed'; statuses: ReadonlyArray<{ id: string; status: AgentStatus }>; at: number }
  | { kind: 'agent-turn-ended'; id: string; reason: TurnEndReason; at: number }

export const initialAgents: AgentBoard = { now: null, rows: [] }

const ENDED: ReadonlySet<AgentStatus> = new Set(['completed', 'failed', 'killed'])

export function isEnded(status: AgentStatus): boolean {
  return ENDED.has(status)
}

const STATUS_OF_TURN_END: Readonly<Record<TurnEndReason, AgentStatus>> = {
  answer: 'completed',
  aborted: 'killed',
  refusal: 'failed',
  error: 'failed',
}

// An ended agent starts again only through a new spawn (a resume). The list
// can still say `running` for a moment after the turn end, so a list status
// does not reopen an ended row; it can only correct how the row ended.
function withStatus(row: AgentRow, status: AgentStatus, at: number): AgentRow {
  if (row.status === status) return row
  if (isEnded(row.status)) return isEnded(status) ? { ...row, status } : row
  return { ...row, status, endedAt: isEnded(status) ? at : null }
}

function mapRows(rows: readonly AgentRow[], fn: (row: AgentRow) => AgentRow): readonly AgentRow[] {
  const next = rows.map(fn)
  return next.every((row, i) => row === rows[i]) ? rows : next
}

export function reduceAgents(state: AgentBoard, event: AgentEvent): AgentBoard {
  switch (event.kind) {
    case 'agent-spawned': {
      const { kind: _kind, at, ...fields } = event
      const row: AgentRow = { ...fields, status: 'running', startedAt: at, endedAt: null }
      const rest = state.rows.filter(r => r.id !== event.id)
      return { now: at, rows: [...rest, row] }
    }
    case 'agents-listed': {
      const byId = new Map(event.statuses.map(s => [s.id, s.status]))
      const rows = mapRows(state.rows, row => {
        const status = byId.get(row.id)
        return status === undefined ? row : withStatus(row, status, event.at)
      })
      // `now` only moves durations; with no live row it changes nothing shown.
      if (rows === state.rows && !rows.some(r => !isEnded(r.status))) return state
      return { now: event.at, rows }
    }
    case 'agent-turn-ended': {
      const rows = mapRows(state.rows, row =>
        row.id === event.id && !row.isTeammate ? withStatus(row, STATUS_OF_TURN_END[event.reason], event.at) : row,
      )
      return rows === state.rows ? state : { now: event.at, rows }
    }
  }
}

/**
 * Milliseconds the agent has run, or `null` before the first read of the time.
 *
 * A live row can show a different value than a `subagentStatusLine` row for the
 * same agent. The status line computes its time from the engine's task
 * `startTime`, and it refreshes on its own interval (some seconds). The mod API
 * does not give `startTime`, so `startedAt` is the time the spawn hook ends, and
 * the pane moves `now` each second. So the status line can show a smaller value
 * until its next refresh. A finished row agrees with the engine's duration to the second.
 */
export function durationMs(row: AgentRow, now: number | null): number | null {
  const end = row.endedAt ?? now
  return end === null ? null : Math.max(0, end - row.startedAt)
}
