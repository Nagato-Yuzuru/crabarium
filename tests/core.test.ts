import { describe, expect, test } from 'claude-code/testing'

import { usageEvent } from '../hooks/collect'
import { cacheTtlMs, initialSession, reduceSession } from '../hooks/core/session'
import { isSupportedEngine } from '../hooks/core/version'

function usageRead(at: number) {
  return { kind: 'usage-read', contextPercent: 12, costUsd: 0.5, startedAt: 7, rateLimits: [], turns: 3, at } as const
}

describe('reduceSession', () => {
  test('records the model of a main-session step', () => {
    const next = reduceSession(initialSession, { kind: 'model-used', model: 'claude-opus-5-5' })
    expect(next).toEqual({ ...initialSession, model: 'claude-opus-5-5' })
  })

  test('the same model keeps the same object', () => {
    const once = reduceSession(initialSession, { kind: 'model-used', model: 'm' })
    expect(reduceSession(once, { kind: 'model-used', model: 'm' })).toBe(once)
  })

  test('each usage read records its time, so the time card moves with the poll', () => {
    const once = reduceSession(initialSession, usageRead(1000))
    expect(reduceSession(once, usageRead(2000))).toEqual({ ...once, readAt: 2000 })
  })

  test('a usage read with unknown values clears the old values', () => {
    const known = reduceSession(initialSession, {
      kind: 'usage-read',
      contextPercent: 40,
      costUsd: 1,
      startedAt: 7,
      rateLimits: [{ kind: 'five_hour', percentUsed: 9 }],
      turns: 2,
      at: 1,
    })
    const unknown = reduceSession(known, {
      kind: 'usage-read',
      contextPercent: null,
      costUsd: null,
      startedAt: 7,
      rateLimits: [],
      turns: 0,
      at: 2,
    })
    expect(unknown).toEqual({ ...initialSession, startedAt: 7, turns: 0, readAt: 2 })
  })
})

const OPUS = 'claude-opus-5-5'

function prompt(costUsd: number | null) {
  return { kind: 'prompt-sent', costUsd } as const
}

function timed(cacheUsed: boolean, sentAt: number, model = OPUS) {
  return { kind: 'step-timed', step: { outputTokens: 10, ms: 500 }, model, sentAt, cacheUsed } as const
}

function switched(ttlMs: number | null, model = OPUS) {
  return { kind: 'model-switched', model, cacheTtlMs: ttlMs } as const
}

describe('reduceSession: the turn base and the cache', () => {
  test('a prompt sets the turn base and the cost from the same read', () => {
    const s = [prompt(0), prompt(1.5)].reduce(reduceSession, { ...initialSession, costUsd: 9 })
    expect([s.turnBaseCost, s.costUsd]).toEqual([1.5, 1.5])
  })

  test('a model switch sets the TTL and the model, and makes the cache cold', () => {
    const s = [timed(true, 1000), switched(3_600_000, 'claude-sonnet-5-5')].reduce(reduceSession, initialSession)
    expect(s.cache).toEqual({ ttlMs: 3_600_000, model: 'claude-sonnet-5-5', use: { kind: 'cold' } })
  })

  test('a request that used the cache of the switched-to model counts from its send', () => {
    const s = [switched(300_000), timed(true, 1000)].reduce(reduceSession, initialSession)
    expect([s.cache.use, s.lastStep]).toEqual([
      { kind: 'used', at: 1000 },
      { outputTokens: 10, ms: 500 },
    ])
  })

  test('a request that did not touch the cache, or that went to another model, leaves the cache as it was', () => {
    const s = [switched(300_000), timed(true, 1000), timed(false, 5000), timed(true, 9000, 'claude-haiku-5-5')].reduce(
      reduceSession,
      initialSession,
    )
    expect(s.cache.use).toEqual({ kind: 'used', at: 1000 })
  })

  test('a step with no output keeps the last tok/s figure but still marks the cache use', () => {
    const s = [switched(300_000), timed(true, 1000), { ...timed(true, 4000), step: null }].reduce(reduceSession, initialSession)
    expect([s.lastStep, s.cache.use]).toEqual([
      { outputTokens: 10, ms: 500 },
      { kind: 'used', at: 4000 },
    ])
  })

  test('a new conversation clears the cost, the turn base, the last step and what is known of the cache; the TTL stays', () => {
    const before = [switched(300_000), prompt(1), timed(true, 5000)].reduce(reduceSession, initialSession)
    const after = reduceSession(before, { kind: 'conversation-replaced' })
    expect([after.costUsd, after.turnBaseCost, after.lastStep, after.cache]).toEqual([
      null,
      null,
      null,
      { ttlMs: 300_000, model: OPUS, use: { kind: 'unknown' } },
    ])
  })

  test('a TTL name the mod does not know gives no TTL', () => {
    expect([cacheTtlMs('5m'), cacheTtlMs('1h'), cacheTtlMs('30m')]).toEqual([300_000, 3_600_000, null])
  })
})

describe('usageEvent', () => {
  test('maps the status-line figures', () => {
    const event = usageEvent(
      {
        startedAt: 5,
        context: { window: 200000, tokens: 50000, percent: 25 },
        rateLimits: [{ kind: 'five_hour', percentUsed: 23.5, resetsAt: '2026-10-16T12:00:00Z' }],
        cost: { usd: 1.25 },
      },
      4,
      9,
    )
    expect(event).toEqual({
      kind: 'usage-read',
      contextPercent: 25,
      costUsd: 1.25,
      startedAt: 5,
      rateLimits: [{ kind: 'five_hour', percentUsed: 23.5 }],
      turns: 4,
      at: 9,
    })
  })

  test('maps missing figures to unknown, not to zero', () => {
    const event = usageEvent({ startedAt: 0, context: { window: 200000 }, rateLimits: [] }, 0, 9)
    expect(event).toEqual({ kind: 'usage-read', contextPercent: null, costUsd: null, startedAt: 0, rateLimits: [], turns: 0, at: 9 })
  })
})

describe('isSupportedEngine', () => {
  test('accepts the minimum version and later ones', () => {
    expect(isSupportedEngine('2.1.300', '2.1.300')).toBe(true)
    expect(isSupportedEngine('2.1.301', '2.1.300')).toBe(true)
    expect(isSupportedEngine('2.2.0', '2.1.300')).toBe(true)
    expect(isSupportedEngine('3.0.0', '2.1.300')).toBe(true)
  })

  test('accepts a development build of the minimum release', () => {
    expect(isSupportedEngine('2.1.300-dev.20261015.t101500.sha1a2b3c4', '2.1.300')).toBe(true)
  })

  test('rejects earlier versions', () => {
    expect(isSupportedEngine('2.1.299', '2.1.300')).toBe(false)
    expect(isSupportedEngine('2.0.999', '2.1.300')).toBe(false)
    expect(isSupportedEngine('1.9.400', '2.1.300')).toBe(false)
  })

  test('rejects a version that does not parse', () => {
    expect(isSupportedEngine('', '2.1.300')).toBe(false)
    expect(isSupportedEngine('2.1', '2.1.300')).toBe(false)
  })
})
