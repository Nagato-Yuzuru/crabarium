import { describe, expect, test } from 'claude-code/testing'

import { usageEvent } from '../hooks/collect'
import { initialSession, reduceSession } from '../hooks/core/session'
import { isSupportedEngine } from '../hooks/core/version'
import { sessionRows } from '../hooks/view/pane'

describe('reduceSession', () => {
  test('records the model of a main-session step', () => {
    const next = reduceSession(initialSession, { kind: 'model-used', model: 'claude-opus-5-5' })
    expect(next).toEqual({ model: 'claude-opus-5-5', contextPercent: null, costUsd: null })
  })

  test('keeps the same object when nothing changed, so readers do not redraw', () => {
    const once = reduceSession(initialSession, { kind: 'usage-read', contextPercent: 12, costUsd: 0.5 })
    const twice = reduceSession(once, { kind: 'usage-read', contextPercent: 12, costUsd: 0.5 })
    expect(twice).toBe(once)
    expect(reduceSession(once, { kind: 'model-used', model: 'm' })).not.toBe(once)
  })

  test('a usage read with unknown values clears the old values', () => {
    const known = reduceSession(initialSession, { kind: 'usage-read', contextPercent: 40, costUsd: 1 })
    const unknown = reduceSession(known, { kind: 'usage-read', contextPercent: null, costUsd: null })
    expect(unknown).toEqual(initialSession)
  })
})

describe('usageEvent', () => {
  test('maps the status-line figures', () => {
    const event = usageEvent({ startedAt: 0, context: { window: 200000, tokens: 50000, percent: 25 }, rateLimits: [], cost: { usd: 1.25 } })
    expect(event).toEqual({ kind: 'usage-read', contextPercent: 25, costUsd: 1.25 })
  })

  test('maps missing figures to unknown, not to zero', () => {
    const event = usageEvent({ startedAt: 0, context: { window: 200000 }, rateLimits: [] })
    expect(event).toEqual({ kind: 'usage-read', contextPercent: null, costUsd: null })
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

describe('sessionRows', () => {
  test('shows unknown values as a dash', () => {
    expect(sessionRows(initialSession)).toEqual([
      ['model', '—'],
      ['context', '—'],
      ['cost', '—'],
    ])
  })

  test('rounds the context percent and shows cost with two decimals', () => {
    expect(sessionRows({ model: 'm', contextPercent: 41.6, costUsd: 0.005 })).toEqual([
      ['model', 'm'],
      ['context', '42%'],
      ['cost', '$0.01'],
    ])
  })
})
