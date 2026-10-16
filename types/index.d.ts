// The state contract. The engine requires it to be self-contained, so the
// domain types that live in `$.state` are declared here and the core imports them.

/** The main session as the pane shows it; `null` is unknown. */
export type MainSession = {
  model: string | null
  contextPercent: number | null
  costUsd: number | null
  /** When the session that the cost counts from began, epoch milliseconds. */
  startedAt: number | null
  /**
   * When the usage was last read. Each poll moves it, so the pane redraws and
   * the time card moves even when no agent is live.
   */
  readAt: number | null
  /** The rate-limit windows of the last read; empty off a subscription. */
  rateLimits: readonly RateLimit[]
  /** The prompts that the user sent in this conversation, as the engine counts them; `null` before the first read. */
  turns: number | null
  /** The session cost when the user sent the last prompt; `null` before it. */
  turnBaseCost: number | null
  /** The last main-session request that answered; `null` before it. */
  lastStep: TimedStep | null
  cache: PromptCache
}

/** One rate-limit window: the engine's kind (`five_hour`) and how much of it is used, 0 to 100. */
export type RateLimit = { kind: string; percentUsed: number }

/** A model request: its output tokens and how long the output took, from the first chunk to the last. */
export type TimedStep = { outputTokens: number; ms: number }

/** What the mod knows of the cache: nothing yet, cold, or used by a request sent at `at`. */
export type CacheUse = { kind: 'unknown' } | { kind: 'cold' } | { kind: 'used'; at: number }

/**
 * The prompt cache of the main session. `ttlMs` and `model` are `null` until
 * the engine tells them, which it does only at a model switch.
 */
export type PromptCache = { ttlMs: number | null; model: string | null; use: CacheUse }

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

/** Token counts, as the API reports them for each request, summed. */
export type TokenSums = { input: number; output: number; cacheRead: number; cacheWrite: number }

/** The last request of an agent: its prompt size (all input kinds), the model that answered, and the effort. */
export type LastRequest = { promptTokens: number; model: string; effort: string | null }

/** One agent's usage over all its requests, and its last request. */
export type AgentUsage = { tokens: TokenSums; last: LastRequest }

/**
 * The usage of the main session and of each agent, by agent id. `main` is
 * `null` before the main session's first request; an agent with no request
 * has no key.
 */
export type UsageBoard = {
  main: TokenSums | null
  agents: Readonly<Record<string, AgentUsage>>
}

declare module 'claude-code' {
  interface PluginState {
    crabarium: { session: Shaped<MainSession>; agents: AgentBoard; usage: UsageBoard }
  }
}
