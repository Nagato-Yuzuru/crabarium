import { describe, expect, test } from 'claude-code/testing'

import { avatarMode, parseRules, pickOutfit, selectOutfit, stem } from '../hooks/core/avatar/select'
import type { AgentInfo, Settings } from '../hooks/core/avatar/select'
import { parsePack } from '../hooks/core/pack/pack'
import type { Pack } from '../hooks/core/pack/pack'
import { validPack } from './fixtures/packs'

// The fixture pack with three hats and roles for some of them.
function packWith(roles: unknown): Pack {
  const result = parsePack({
    ...validPack,
    parts: {
      hat: {
        dot: { anchor: 'head', pivot: [0, 0], rows: ['c'], palette: { c: '#0000ff' } },
        cap: { anchor: 'head', pivot: [0, 0], rows: ['a'] },
        wig: { anchor: 'head', pivot: [0, 0], rows: ['b'] },
      },
    },
    roles,
  })
  if (!result.ok) throw new Error(JSON.stringify(result.errors))
  return result.pack
}

const PACK = packWith({
  reviewer: [{ parts: { hat: 'wig' } }],
  builder: [{ parts: { hat: 'cap' } }],
  explorer: [{ parts: { hat: 'cap' } }],
})

function agent(description: string, type = 'general-purpose', id = 'a1'): AgentInfo {
  return { id, type, description }
}

function settings(rules = '', mode: Settings['mode'] = 'keywords'): Settings {
  return { mode, rules: parseRules(rules).rules }
}

describe('parseRules', () => {
  test('reads roles, parts, and weighted outfits, and lowers the pattern', () => {
    expect(parseRules(' Linus-Reviewer = reviewer ; migration = hat:cap*3 | hat:wig ;').rules).toEqual([
      { pattern: 'linus-reviewer', target: { kind: 'role', role: 'reviewer' } },
      {
        pattern: 'migration',
        target: {
          kind: 'outfits',
          outfits: [
            { parts: { hat: 'cap' }, weight: 3 },
            { parts: { hat: 'wig' }, weight: 1 },
          ],
        },
      },
    ])
  })

  test('leaves out each rule that does not parse, and names it', () => {
    const bad = ['no equals', '= reviewer', 'two words = reviewer', 'x = wizard', 'y = hat:cap*0', 'z = hat:cap*2*3']
    const odd = ['w = hat:cap*1e2', 'v = hat:cap*0x10', 'u = hat:cap*1.0', 't = hat:cap hat:wig']
    const { rules, errors } = parseRules([...bad, ...odd, 'ok = tester'].join('; '))
    expect(rules).toEqual([{ pattern: 'ok', target: { kind: 'role', role: 'tester' } }])
    expect(errors.map(e => e.rule)).toEqual([...bad, ...odd])
    expect(errors[3]!.message).toContain('is not a role')
  })

  test('an empty text has no rules and no errors', () => {
    expect(parseRules('  ;  ; ')).toEqual({ rules: [], errors: [] })
  })
})

describe('stem', () => {
  test('a keyword matches its common forms', () => {
    const forms = [
      ['Writing', 'write'],
      ['Exploring', 'explore'],
      ['Explorer', 'explore'],
      ['Planner', 'plan'],
      ['Planning', 'plan'],
      ['Creating', 'create'],
      ['Mapping', 'map'],
      ['Scanning', 'scan'],
      ['Tracing', 'trace'],
      ['Validating', 'validate'],
      ['reviewer', 'review'],
      ['fixes', 'fix'],
      ['checker', 'check'],
    ] as const
    expect(forms.filter(([word, keyword]) => stem(word) !== stem(keyword))).toEqual([])
  })

  test('a word that only begins like a keyword does not match it', () => {
    const others = [
      ['address', 'add'],
      ['ready', 'read'],
      ['testament', 'test'],
      ['listen', 'list'],
    ] as const
    expect(others.filter(([word, keyword]) => stem(word) === stem(keyword))).toEqual([])
  })
})

describe('selectOutfit: the sources in order', () => {
  test('a user rule wins over the keywords and the type', () => {
    expect(selectOutfit(PACK, agent('Review the loop', 'coder'), settings('coder = hat:dot'))).toEqual({
      source: 'rule',
      role: null,
      parts: { hat: 'dot' },
    })
  })

  test('a rule matches the type exactly, or a whole word of the description, in any case', () => {
    const s = settings('migration = hat:dot')
    expect(selectOutfit(PACK, agent('Plan the Migration'), s).source).toBe('rule')
    expect(selectOutfit(PACK, agent('Plan the migrations'), s).source).not.toBe('rule')
    expect(selectOutfit(PACK, agent('x', 'MIGRATION'), s).source).toBe('rule')
  })

  test('a rule whose parts the pack does not have goes to the next source', () => {
    expect(selectOutfit(PACK, agent('Review the loop'), settings('review = hat:crown'))).toEqual({
      source: 'keywords',
      role: 'reviewer',
      parts: { hat: 'wig' },
    })
  })

  test('a rule with a role that the pack does not dress goes to the next source', () => {
    expect(selectOutfit(PACK, agent('Review the loop'), settings('review = tester')).source).toBe('keywords')
  })

  test('the first keyword of the description gives the role, also with a common ending', () => {
    expect(selectOutfit(PACK, agent('Reviewing the fix'), settings()).role).toBe('reviewer')
    expect(selectOutfit(PACK, agent('Fix what the review found'), settings()).role).toBe('builder')
  })

  test('a role from the keywords that the pack does not dress falls to the type', () => {
    expect(selectOutfit(PACK, agent('Test the loop', 'Explore'), settings())).toEqual({
      source: 'type',
      role: 'explorer',
      parts: { hat: 'cap' },
    })
  })

  test('the type gives a role by its name or by a whole word in it', () => {
    expect(selectOutfit(PACK, agent('the loop', 'linus-reviewer'), settings()).role).toBe('reviewer')
    expect(selectOutfit(PACK, agent('the loop', 'coder'), settings()).role).toBe('builder')
    // Not by a part of a word: preview has no review, attestation no test.
    expect(selectOutfit(PACK, agent('the loop', 'ui-preview'), settings()).source).toBe('default')
    expect(selectOutfit(PACK, agent('the loop', 'attestation-x'), settings()).source).toBe('default')
  })

  test('a hyphenated word counts as its parts for the keywords', () => {
    expect(selectOutfit(PACK, agent('Code-review the loop'), settings()).role).toBe('reviewer')
  })

  test('an outfit fills its slots, and the pack defaults fill the others', () => {
    const withFace = parsePack({
      ...validPack,
      anchors: { head: [2, 0], face: [1, 1] },
      parts: {
        hat: { cap: { anchor: 'head', pivot: [0, 0], rows: ['a'] } },
        face: { smile: { anchor: 'face', pivot: [0, 0], rows: ['b'] } },
      },
      defaults: { parts: { face: 'smile' } },
      roles: { reviewer: [{ parts: { hat: 'cap' } }] },
    })
    if (!withFace.ok) throw new Error(JSON.stringify(withFace.errors))
    expect(selectOutfit(withFace.pack, agent('Review it'), settings()).parts).toEqual({ face: 'smile', hat: 'cap' })
    expect(selectOutfit(withFace.pack, agent('x'), settings('x = hat:cap')).parts).toEqual({ face: 'smile', hat: 'cap' })
  })

  test('with nothing that fits, the pack defaults', () => {
    expect(selectOutfit(PACK, agent('the loop'), settings())).toEqual({ source: 'default', role: null, parts: { hat: 'dot' } })
  })

  test('mode off skips the keywords and the type, but keeps the user rules', () => {
    const off = settings('loop = hat:wig', 'off')
    expect(selectOutfit(PACK, agent('Review the loop', 'coder'), off).source).toBe('rule')
    expect(selectOutfit(PACK, agent('Review it', 'coder'), off).source).toBe('default')
  })
})

describe('pickOutfit', () => {
  const outfits = [
    { parts: { hat: 'cap' }, weight: 3 },
    { parts: { hat: 'wig' }, weight: 1 },
  ]

  test('the same seed always picks the same outfit', () => {
    const picks = Array.from({ length: 5 }, () => pickOutfit(PACK, outfits, 'agent-7'))
    expect(new Set(picks.map(p => JSON.stringify(p))).size).toBe(1)
  })

  test('picks by weight over many seeds', () => {
    const caps = Array.from({ length: 400 }, (_, i) => pickOutfit(PACK, outfits, `agent-${i}`)).filter(p => p?.hat === 'cap').length
    // 3 to 1: about 300 of 400.
    expect(caps).toBeGreaterThan(250)
    expect(caps).toBeLessThan(350)
  })

  test('leaves out outfits that the pack cannot dress; none left is null', () => {
    expect(pickOutfit(PACK, [{ parts: { hat: 'crown' }, weight: 99 }, { parts: { hat: 'wig' } }], 'x')).toEqual({ hat: 'wig' })
    expect(pickOutfit(PACK, [{ parts: { hat: 'crown' } }], 'x')).toBeNull()
  })
})

test('avatarMode falls back to keywords for an unknown value', () => {
  expect(['off', 'keywords', 'model', undefined].map(avatarMode)).toEqual(['off', 'keywords', 'keywords', 'keywords'])
})
