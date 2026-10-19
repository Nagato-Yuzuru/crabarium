// The usage of each agent loop, summed over its model requests. Pure: the
// request figures come in with the events.
//
// The counts are the API's own, request by request; only the sums are the
// mod's. Two limits: a hook beneath the mod that sends a request again shows
// the mod only the last answer, and a resumed session starts the sums at zero
// while the engine's cost keeps the earlier part. There is no cost per agent:
// see the note in ./models.ts.
import type { AgentUsage, LastRequest, TokenSums, UsageBoard } from '../../../types'
import { contextWindowOf, promptTokens } from './models.ts'

export type { AgentUsage, LastRequest, TokenSums, UsageBoard }

/** One model request that answered: whose loop, which model, how hard, and what it used. */
export type StepFinished = {
  kind: 'step-finished'
  /** `null` for the main session. */
  agentId: string | null
  /** The model that answered, by the id the API reports. */
  model: string
  effort: string | null
  tokens: TokenSums
}

/** A conversation ended (`/clear`, or a resume took its place): the sums start again. */
export type UsageReset = { kind: 'usage-reset' }

export type UsageEvent = StepFinished | UsageReset

export const initialUsage: UsageBoard = { main: null, agents: {} }

const NO_TOKENS: TokenSums = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

function add(a: TokenSums, b: TokenSums): TokenSums {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
  }
}

// A resume of an agent keeps its key, so its sums go on: they describe the
// agent's whole life, while its row's duration starts again.
export function reduceUsage(state: UsageBoard, event: UsageEvent): UsageBoard {
  if (event.kind === 'usage-reset') return initialUsage
  if (event.agentId === null) return { ...state, main: add(state.main ?? NO_TOKENS, event.tokens) }
  const last: LastRequest = { promptTokens: promptTokens(event.tokens), model: event.model, effort: event.effort }
  const before = state.agents[event.agentId]?.tokens ?? NO_TOKENS
  const agent: AgentUsage = { tokens: add(before, event.tokens), last }
  return { ...state, agents: { ...state.agents, [event.agentId]: agent } }
}

/**
 * The tokens that the requests added: the uncached input, the cache writes,
 * and the output. Cache reads are left out: each request reads the whole
 * cached context again, so in a long session they would be most of a sum that
 * says little about the work. `cacheHitRate` tells how much they were.
 */
export function newTokens(t: TokenSums): number {
  return t.input + t.cacheWrite + t.output
}

/** The share of all input that the prompt cache served, 0 to 100; `null` before any input. */
export function cacheHitRate(t: TokenSums): number | null {
  const input = t.input + t.cacheRead + t.cacheWrite
  return input === 0 ? null : (t.cacheRead / input) * 100
}

/** The sums of the main session and every agent together; `null` before the first request. */
export function sessionSums(board: UsageBoard): TokenSums | null {
  const sums = [...(board.main === null ? [] : [board.main]), ...Object.values(board.agents).map(a => a.tokens)]
  return sums.length === 0 ? null : sums.reduce(add, NO_TOKENS)
}

/** The last prompt over its model's context window, 0 to 100; `null` when the window is unknown. */
export function contextPercent(last: LastRequest): number | null {
  const window = contextWindowOf(last.model)
  return window === null ? null : (last.promptTokens / window) * 100
}
