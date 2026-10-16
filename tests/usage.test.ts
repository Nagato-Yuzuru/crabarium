import { describe, expect, test } from 'claude-code/testing'

import { stepEvent } from '../hooks/collect'
import { contextWindowOf } from '../hooks/core/usage/models'
import { cacheHitRate, contextPercent, initialUsage, newTokens, reduceUsage, sessionSums } from '../hooks/core/usage/usage'
import type { StepFinished, TokenSums } from '../hooks/core/usage/usage'
import { formatEffort, formatTokens } from '../hooks/view/layout'

function step(agentId: string | null, model: string, tokens: TokenSums, effort: string | null = null): StepFinished {
  return { kind: 'step-finished', agentId, model, effort, tokens }
}

describe('contextWindowOf', () => {
  test('finds a known id after a provider prefix and before a suffix', () => {
    const ids = [
      'claude-haiku-4-5',
      'us.anthropic.claude-haiku-4-5',
      'claude-haiku-4-5-20251001',
      'anthropic.claude-haiku-4-5-v1:0',
      'claude-haiku-4-5@20251001',
      'claude-haiku-4-5[1m]',
    ]
    expect(ids.map(contextWindowOf)).toEqual(ids.map(() => 200_000))
  })

  test('a newer model of a known family is unknown, not the shorter id', () => {
    expect(['claude-opus-5-9', 'claude-haiku-4-55', 'xclaude-haiku-4-5', 'claude-next-9', ''].map(contextWindowOf)).toEqual([
      null,
      null,
      null,
      null,
      null,
    ])
  })
})

describe('reduceUsage', () => {
  const t: TokenSums = { input: 100, output: 50, cacheRead: 900, cacheWrite: 0 }

  test('sums each agent on its own, and the main session apart', () => {
    const board = [step('a1', 'claude-haiku-5-5', t), step('a1', 'claude-haiku-5-5', t), step(null, 'claude-opus-5-5', t)].reduce(
      reduceUsage,
      initialUsage,
    )
    expect([board.agents.a1!.tokens.input, board.agents.a1!.tokens.cacheRead, board.main?.output]).toEqual([200, 1800, 50])
    expect(sessionSums(board)).toEqual({ input: 300, output: 150, cacheRead: 2700, cacheWrite: 0 })
  })

  test('the last request gives the prompt size, the model, and the effort', () => {
    const board = [step('a1', 'claude-opus-5-5', t, 'low'), step('a1', 'claude-haiku-4-5', { ...t, cacheWrite: 1000 }, 'high')].reduce(
      reduceUsage,
      initialUsage,
    )
    expect(board.agents.a1!.last).toEqual({ promptTokens: 2000, model: 'claude-haiku-4-5', effort: 'high' })
    // Haiku 4.5 has a 200,000-token window.
    expect(contextPercent(board.agents.a1!.last)).toBe(1)
  })

  test('a reset starts every sum again', () => {
    const board = [step('a1', 'claude-haiku-5-5', t), step(null, 'claude-opus-5-5', t)].reduce(reduceUsage, initialUsage)
    expect(reduceUsage(board, { kind: 'usage-reset' })).toEqual(initialUsage)
  })

  test('before any request the session has no token count, and an unknown model has no context percent', () => {
    expect(sessionSums(initialUsage)).toBeNull()
    expect(contextPercent(reduceUsage(initialUsage, step('a1', 'claude-next-9', t)).agents.a1!.last)).toBeNull()
  })
})

describe('newTokens and cacheHitRate', () => {
  test('new tokens leave out the cache reads, which the hit rate counts instead', () => {
    const t: TokenSums = { input: 1000, output: 500, cacheRead: 36_000, cacheWrite: 3000 }
    expect(newTokens(t)).toBe(4500)
    // 36,000 of 40,000 input tokens came from the cache.
    expect(cacheHitRate(t)).toBe(90)
  })

  test('with no input there is no hit rate', () => {
    expect(cacheHitRate({ input: 0, output: 5, cacheRead: 0, cacheWrite: 0 })).toBeNull()
  })
})

describe('formatTokens and formatEffort', () => {
  test('shows three significant digits with a k or M unit, and carries 1000k to 1M', () => {
    const cases = [
      [0, '0'],
      [999, '999'],
      [1000, '1k'],
      [48_240, '48.2k'],
      [212_400, '212k'],
      [999_499, '999k'],
      [999_500, '1M'],
      [1_240_000, '1.24M'],
      [12_400_000, '12.4M'],
    ] as const
    expect(cases.map(([n]) => formatTokens(n))).toEqual(cases.map(([, text]) => text))
  })

  test('an effort word stays; a number is a thinking budget', () => {
    expect([formatEffort('xhigh'), formatEffort('31999')]).toEqual(['xhigh', 'budget 32k'])
  })
})

describe('stepEvent', () => {
  test('maps the step input and the usage, and a numeric effort to text', () => {
    const usage = {
      model: 'claude-opus-5-5',
      input_tokens: 1,
      output_tokens: 2,
      cache_read_input_tokens: 3,
      cache_creation_input_tokens: 4,
    }
    expect(stepEvent({ agentId: 'a1', effort: 3 }, usage)).toEqual({
      kind: 'step-finished',
      agentId: 'a1',
      model: 'claude-opus-5-5',
      effort: '3',
      tokens: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 },
    })
    expect(stepEvent({}, usage)).toEqual(expect.objectContaining({ agentId: null, effort: null }))
  })
})
