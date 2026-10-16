// The main session as the pane shows it. Pure: no engine calls, no clock.
import type { CacheUse, MainSession, PromptCache, RateLimit, TimedStep } from '../../types'

export type { CacheUse, MainSession, PromptCache, RateLimit, TimedStep }

export type SessionEvent =
  | { kind: 'model-used'; model: string }
  | {
      kind: 'usage-read'
      contextPercent: number | null
      costUsd: number | null
      startedAt: number
      rateLimits: readonly RateLimit[]
      /** `null` when the engine did not answer. */
      turns: number | null
      at: number
    }
  /** The user sent a prompt, at this session cost. */
  | { kind: 'prompt-sent'; costUsd: number | null }
  /**
   * A main-session request answered. `model` is the model that the request
   * named; `sentAt` is when the engine sent it; `cacheUsed` says that it read
   * or wrote the prompt cache. `step` is `null` when no output came.
   */
  | { kind: 'step-timed'; step: TimedStep | null; model: string; sentAt: number; cacheUsed: boolean }
  /** The model changed. The new model has no cache yet. `cacheTtlMs` is `null` for a TTL the mod does not know. */
  | { kind: 'model-switched'; model: string; cacheTtlMs: number | null }
  /** A `/clear` started a new conversation, or a resume put an old one in its place. */
  | { kind: 'conversation-replaced' }

export const initialSession: MainSession = {
  model: null,
  contextPercent: null,
  costUsd: null,
  startedAt: null,
  readAt: null,
  rateLimits: [],
  turns: null,
  turnBaseCost: null,
  lastStep: null,
  cache: { ttlMs: null, model: null, use: { kind: 'unknown' } },
}

const CACHE_TTL_MS: Readonly<Record<string, number>> = { '5m': 5 * 60_000, '1h': 60 * 60_000 }

/** The TTL that the engine names, in milliseconds; `null` for a name that the mod does not know. */
export function cacheTtlMs(name: string): number | null {
  return CACHE_TTL_MS[name] ?? null
}

// A request refreshes the cache entry when the API reads the prompt, before
// the first output token. So the countdown counts from the send: it can end
// early, but never late.
function cacheAfterStep(cache: PromptCache, model: string, sentAt: number, cacheUsed: boolean): PromptCache {
  // A request to another model (a fallback, or one that a hook sent elsewhere) uses another cache.
  if (!cacheUsed || (cache.model !== null && cache.model !== model)) return cache
  return { ...cache, use: { kind: 'used', at: sentAt } }
}

export function reduceSession(state: MainSession, event: SessionEvent): MainSession {
  switch (event.kind) {
    case 'model-used':
      return state.model === event.model ? state : { ...state, model: event.model }
    case 'usage-read': {
      const { kind: _kind, at, ...usage } = event
      return { ...state, ...usage, readAt: at }
    }
    case 'prompt-sent':
      // The cost comes from the same read as the base, so the turn cost never mixes an old cost with a new base.
      return { ...state, costUsd: event.costUsd, turnBaseCost: event.costUsd }
    case 'step-timed':
      return {
        ...state,
        lastStep: event.step ?? state.lastStep,
        cache: cacheAfterStep(state.cache, event.model, event.sentAt, event.cacheUsed),
      }
    case 'model-switched':
      return { ...state, cache: { ttlMs: event.cacheTtlMs, model: event.model, use: { kind: 'cold' } } }
    case 'conversation-replaced':
      // The TTL is the session's setting, so it stays. Whether the cache is
      // still warm is not known: a resume can come back within the TTL, and
      // a /clear keeps the system prompt. The next request tells.
      return {
        ...state,
        costUsd: null,
        turnBaseCost: null,
        lastStep: null,
        cache: { ...state.cache, use: { kind: 'unknown' } },
      }
  }
}

/** The cost since the user's last prompt, subagents included; `null` when it is not known. */
export function turnCost(s: MainSession): number | null {
  if (s.costUsd === null || s.turnBaseCost === null) return null
  const cost = s.costUsd - s.turnBaseCost
  // Below the base, the cost started again under the mod (a /clear it did not see).
  return cost < 0 ? null : cost
}

/** The output tokens per second of the last request; `null` before it, or when it took no time. */
export function tokensPerSecond(step: TimedStep | null): number | null {
  return step === null || step.ms <= 0 ? null : step.outputTokens / (step.ms / 1000)
}

/**
 * The time until the prompt cache expires: 0 when it is cold, `null` when it
 * is not known. The mod does not guess: a wrong countdown would be worse than
 * none.
 */
export function cacheLeftMs(cache: PromptCache, now: number): number | null {
  if (cache.ttlMs === null) return null
  switch (cache.use.kind) {
    case 'unknown':
      return null
    case 'cold':
      return 0
    case 'used':
      return Math.max(0, cache.use.at + cache.ttlMs - now)
  }
}
