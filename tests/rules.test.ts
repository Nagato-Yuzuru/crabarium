import { describe, expect, test } from 'claude-code/testing'

import { loadPack } from '../hooks/core/pack/load.ts'
import { parsePack } from '../hooks/core/pack/pack.ts'
import type { Pack } from '../hooks/core/pack/pack.ts'
import { checkRules, parseRules } from '../hooks/core/pack/rules.ts'
import { validPack } from './fixtures/packs.ts'

// The fixture pack with a body variant and a held part, so rules can name them.
const json = JSON.stringify({
  ...validPack,
  groups: { body: { ...validPack.groups.body, variants: { squash: ['aaaa', 'aaaa'] } } },
  parts: { ...validPack.parts, held: { hammer: { anchor: 'head', pivot: [0, 0], rows: ['a'] } } },
  motions: { hop: { fps: 4, loop: false, frames: [{ offset: { '*': [0, -1] } }, {}] } },
})
const pack = (parsePack(JSON.parse(json)) as { ok: true; pack: Pack }).pack

function errorsOf(css: string): string[] {
  const { rules, errors } = parseRules(css)
  return [...errors, ...checkRules(pack, rules)].map(e => `${e.line}:${e.column} ${e.message}`)
}

function messages(css: string): string[] {
  return parseRules(css).errors.map(e => `${e.line}:${e.column} ${e.message}`)
}

describe('parseRules', () => {
  test('reads selectors, specificity, and each property', () => {
    const { rules, errors } = parseRules(`
      :root { body: base; tricks: hop 2, bob; idle-every: 8s 20s; }
      [state=working] { play: walk; }
      [held=hammer][state=working] { body: squash; lock: body; }
      [role=builder]:finished { once: hop; }
    `)
    expect(errors).toEqual([])
    expect(rules.map(r => [r.selector, r.specificity, r.set])).toEqual([
      [{ attrs: {}, event: null }, 0, { pose: { body: 'base' }, lock: [], tricks: { hop: 2, bob: 1 }, idleEvery: [8000, 20000] }],
      [{ attrs: { state: 'working' }, event: null }, 1, { pose: {}, lock: [], play: 'walk' }],
      [{ attrs: { held: 'hammer', state: 'working' }, event: null }, 2, { pose: { body: 'squash' }, lock: ['body'] }],
      [{ attrs: { role: 'builder' }, event: 'finished' }, 2, { pose: {}, lock: [], once: { hop: 1 } }],
    ])
    expect(rules[1]!.at).toEqual({ line: 3, column: 7 })
  })

  test('a selector list gives one rule for each selector', () => {
    const { rules } = parseRules('[state=idle], [state=working] { play: bob; }')
    expect(rules.map(r => r.selector.attrs)).toEqual([{ state: 'idle' }, { state: 'working' }])
  })

  test('each form outside the subset is an error with its line and column, and its rule is left out', () => {
    const cases: [css: string, error: string][] = [
      ['a { play: bob; }', '1:1 "a": pack.css takes only :root, [key=value], and the events :finished :failed :click, with no combinators'],
      ['[role=builder] > [held=hammer] { play: bob; }', '1:1 "[role=builder] > [held=hammer]": pack.css takes only'],
      [':not([role=builder]) { play: bob; }', '1:1 ":not([role=builder])": pack.css takes only'],
      ['[role^=build] { play: bob; }', '1:1 "[role^=build]": pack.css takes only'],
      ['@media (x) { :root { play: bob; } }', '1:1 @media is not supported: pack.css takes only rules'],
      [':root { play: bob !important; }', '1:9 !important is not supported: make the rule more specific'],
      [':root { play: bob; play: walk; }', '1:20 play is set twice in this rule'],
      [':root { once: hop; }', '1:9 once plays on an event: put it in a rule with :finished :failed :click'],
      [':finished { play: hop; }', '1:13 a rule with :finished sets only once'],
      [':finished:failed { once: hop; }', '1:1 ":finished:failed" waits for two events; one event comes at a time'],
      ['[state=idle][state=working] { play: bob; }', '1:1 "[state=idle][state=working]" names state twice, so it never holds'],
      [':root { tricks: hop 0; }', '1:9 tricks: the weight of hop is not a whole number from 1 to 100'],
      [':root { idle-every: 20s 8s; }', '1:9 idle-every the times are at least 1s, and the second is not shorter than the first'],
      [':root { idle-every: soon; }', '1:9 idle-every is a time, or a shortest and a longest time, for example 8s 20s'],
    ]
    for (const [css, error] of cases) {
      const { rules, errors } = parseRules(css)
      expect(errors.map(e => `${e.line}:${e.column} ${e.message}`).join('\n')).toContain(error)
      expect(rules.length).toBe(0)
    }
  })

  test('a nested rule adds its conditions to the parent, comes after it, and keeps its own line', () => {
    const { rules, errors } = parseRules(`[held=hammer] {
  body: squash;
  &[state=working] { play: walk; }
  &:finished { once: hop; }
}`)
    expect(errors).toEqual([])
    expect(rules.map(r => [r.selector, r.specificity, r.at.line])).toEqual([
      [{ attrs: { held: 'hammer' }, event: null }, 1, 1],
      [{ attrs: { held: 'hammer', state: 'working' }, event: null }, 2, 3],
      [{ attrs: { held: 'hammer' }, event: 'finished' }, 2, 4],
    ])
  })

  test('a nested selector is & and then conditions; a descendant or a repeated key is an error', () => {
    expect(messages('[held=hammer] {\n  & [state=idle] { play: bob; }\n}')[0]).toContain(
      '2:3 "& [state=idle]": a nested selector is & and then conditions',
    )
    expect(messages('[held=hammer] { [state=idle] { play: bob; } }')[0]).toContain('a nested selector is &')
    expect(messages('[state=idle] { &[state=working] { play: bob; } }')[0]).toContain('names state again under a rule that names it')
    expect(messages(':finished { &:failed { once: hop; } }')[0]).toContain('waits for a second event')
  })

  test('a syntax error comes from the parser, with its line and column', () => {
    expect(parseRules(':root { play bob; }').errors).toEqual([{ line: 1, column: 14, message: "property missing ':'" }])
  })
})

describe('checkRules', () => {
  test('a valid sheet has no errors', () => {
    expect(errorsOf('[held=hammer][role=builder] { body: squash; lock: body; play: hop; tricks: walk; }')).toEqual([])
  })

  test('each name must be in the pack', () => {
    expect(errorsOf('[role=chef] { play: bob; }')).toEqual([
      '1:1 [role=chef]: the roles are explorer, reviewer, builder, tester, planner, researcher',
    ])
    expect(errorsOf('[state=asleep] { play: bob; }')).toEqual([
      '1:1 [state=asleep]: the states are entering, working, idle, finished, failed, leaving',
    ])
    expect(errorsOf('[cape=red] { play: bob; }')).toEqual(['1:1 [cape=red]: the keys are role, state, and the part slots'])
    expect(errorsOf('[held=wand] { play: bob; }')).toEqual(['1:1 [held=wand]: "wand" is not a part in parts.held'])
    expect(errorsOf(':root { arm: up; }')).toEqual(['1:9 "arm" is not figure, a group, or a part slot, so it is not a channel'])
    expect(errorsOf(':root { body: up; }')).toEqual(['1:9 body: "up" is not base or a variant of body'])
    expect(errorsOf(':root { lock: arm; }')).toEqual(['1:9 "arm" is not figure, a group, or a part slot, so it is not a channel'])
    expect(errorsOf(':root {\n  play: nope;\n}')).toEqual(['2:3 "nope" is not a motion in the pack or a built-in motion'])
  })
})

describe('loadPack', () => {
  test('a pack with no pack.css has no rules', () => {
    expect(loadPack({ json })).toEqual({ ok: true, pack, rules: [] })
  })

  test('pack.css errors carry the file, the line, and the column in the path', () => {
    expect(loadPack({ json, css: ':root { play: nope; }' })).toEqual({
      ok: false,
      errors: [{ path: 'pack.css:1:9', message: '"nope" is not a motion in the pack or a built-in motion' }],
    })
  })

  test('the errors of both files come together', () => {
    const result = loadPack({ json: '{}', css: 'a {}' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.some(e => e.path.startsWith('pack.css:'))).toBe(true)
  })
})
