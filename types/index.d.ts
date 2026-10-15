// The state contract. The engine requires it to be self-contained, so the
// domain types that live in `$.state` are declared here and the core imports them.

/** The main session as the pane shows it; `null` is unknown. */
export type MainSession = {
  model: string | null
  contextPercent: number | null
  costUsd: number | null
}

/** The engine's `AgentStatus`, copied because this file cannot import it. */
export type AgentStatus = 'pending' | 'running' | 'waiting' | 'idle' | 'completed' | 'failed' | 'killed'

/** One subagent or teammate that the pane shows. Times are epoch milliseconds. */
export type AgentRow = {
  id: string
  description: string
  type: string
  model: string
  /** The agent that spawned it; `null` when the main loop did. */
  parentId: string | null
  /** A teammate goes idle between turns, so a turn end does not end it. */
  isTeammate: boolean
  status: AgentStatus
  /** When the status last changed. A one-shot motion, such as a fail pose, plays from here. */
  statusAt: number
  startedAt: number
  endedAt: number | null
}

/** The agents in spawn order, and the time of the last read; `null` before the first read. */
export type AgentBoard = {
  now: number | null
  rows: readonly AgentRow[]
}

declare module 'claude-code' {
  interface PluginState {
    crabarium: { session: MainSession; agents: AgentBoard }
  }
}
