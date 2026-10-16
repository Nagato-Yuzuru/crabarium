// The main session as the pane shows it. Pure: no engine calls, no clock.
import type { MainSession } from '../../types'

export type { MainSession }

export type SessionEvent =
  | { kind: 'model-used'; model: string }
  | { kind: 'usage-read'; contextPercent: number | null; costUsd: number | null; startedAt: number; at: number }

export const initialSession: MainSession = { model: null, contextPercent: null, costUsd: null, startedAt: null, readAt: null }

export function reduceSession(state: MainSession, event: SessionEvent): MainSession {
  switch (event.kind) {
    case 'model-used':
      return state.model === event.model ? state : { ...state, model: event.model }
    case 'usage-read': {
      const { kind: _kind, at, ...usage } = event
      return { ...state, ...usage, readAt: at }
    }
  }
}
