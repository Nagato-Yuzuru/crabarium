import { describe, expect, test } from 'claude-code/testing'

import { usageEvent } from '../hooks/collect'
import { initialSession, reduceSession } from '../hooks/core/session'
import { isSupportedEngine } from '../hooks/core/version'

function usageRead(at: number) {
  return { kind: 'usage-read', contextPercent: 12, costUsd: 0.5, startedAt: 7, at } as const
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
    const known = reduceSession(initialSession, { kind: 'usage-read', contextPercent: 40, costUsd: 1, startedAt: 7, at: 1 })
    const unknown = reduceSession(known, { kind: 'usage-read', contextPercent: null, costUsd: null, startedAt: 7, at: 2 })
    expect(unknown).toEqual({ ...initialSession, startedAt: 7, readAt: 2 })
  })
})

describe('usageEvent', () => {
  test('maps the status-line figures', () => {
    const event = usageEvent(
      { startedAt: 5, context: { window: 200000, tokens: 50000, percent: 25 }, rateLimits: [], cost: { usd: 1.25 } },
      9,
    )
    expect(event).toEqual({ kind: 'usage-read', contextPercent: 25, costUsd: 1.25, startedAt: 5, at: 9 })
  })

  test('maps missing figures to unknown, not to zero', () => {
    const event = usageEvent({ startedAt: 0, context: { window: 200000 }, rateLimits: [] }, 9)
    expect(event).toEqual({ kind: 'usage-read', contextPercent: null, costUsd: null, startedAt: 0, at: 9 })
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
