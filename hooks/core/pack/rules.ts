// `pack.css`: the rules that select a pose and motions by the tags of an
// agent. It is CSS syntax with crabarium properties; the parsers come from
// packages (hooks/vendor/css.js), and this file accepts only the subset below.
// Pure: the text comes in as an argument.
//
//   :root { eyes: base; tricks: jump 1, look 2; idle-every: 8s 20s; }
//   [state=working] { play: walk; }
//   [held=hammer] { armR: hold; lock: armR; }
//   [role=builder]:finished { once: jump; }
import { AttributeAction, CssTypes, parse, parseSelector, SelectorType } from '../../vendor/css.js'
import { BUILTIN_MOTIONS } from './motions.ts'
import { BASE, isChannel, isChannelValue, partOf } from './pack.ts'
import type { Pack, SchemaError } from './pack.ts'
import { CHARACTER_STATES, MAX_WEIGHT, ROLES } from './schema.ts'

/** The events that a rule can wait for, as pseudo-classes. */
export const EVENTS = ['finished', 'failed', 'click'] as const

export type Event = (typeof EVENTS)[number]

/** A line and a column in `pack.css`, from 1. */
export type Place = { line: number; column: number }

/** Motion names with weights, for a random pick. */
export type Weighted = Readonly<Record<string, number>>

/** What one rule sets. A channel is `figure`, a group, or a part slot; its value is `base` (the node's own rows) or a variant. */
export type Declarations = {
  pose: Readonly<Record<string, string>>
  lock: readonly string[]
  play?: string
  tricks?: Weighted
  once?: Weighted
  idleEvery?: readonly [minMs: number, maxMs: number]
}

/** `[key=value]` conditions, all of which must hold, and an optional event. `:root` has neither. */
export type Selector = { attrs: Readonly<Record<string, string>>; event: Event | null }

export type Rule = {
  selector: Selector
  /** The count of conditions and events, as in CSS. `:root` is 0. */
  specificity: number
  set: Declarations
  at: Place
  /** Where each property is, for the checks against the pack. */
  places: Readonly<Record<string, Place>>
}

export type RuleError = Place & { message: string }

const NAME = /^[a-zA-Z][a-zA-Z0-9-]{0,31}$/
const DURATION = /^(\d{1,6}(?:\.\d{1,3})?)(ms|s)$/
const isEvent = (name: string): name is Event => (EVENTS as readonly string[]).includes(name)

type Parsed<T> = { ok: true; value: T } | { ok: false; message: string }
const ok = <T>(value: T): Parsed<T> => ({ ok: true, value })
const no = (message: string): Parsed<never> => ({ ok: false, message })

function parseOneSelector(text: string): Parsed<Selector> {
  let list
  try {
    list = parseSelector(text)
  } catch (error) {
    return no(`${JSON.stringify(text)} is not a selector: ${error instanceof Error ? error.message : String(error)}`)
  }
  // css-tools splits a selector list at its commas, so each text is one selector.
  const [tokens = []] = list
  const [first] = tokens
  if (tokens.length === 1 && first?.type === SelectorType.Pseudo && first.name === 'root' && first.data === null)
    return ok({ attrs: {}, event: null })
  const attrs: Record<string, string> = {}
  let event: Event | null = null
  for (const token of tokens) {
    if (
      token.type === SelectorType.Attribute &&
      token.action === AttributeAction.Equals &&
      token.namespace === null &&
      token.ignoreCase === null
    ) {
      if (!NAME.test(token.name) || !NAME.test(token.value)) return no(`[${token.name}=${token.value}]: a key and a value are names`)
      if (Object.hasOwn(attrs, token.name)) return no(`${JSON.stringify(text)} names ${token.name} twice, so it never holds`)
      attrs[token.name] = token.value
    } else if (token.type === SelectorType.Pseudo && token.data === null && isEvent(token.name)) {
      if (event !== null) return no(`${JSON.stringify(text)} waits for two events; one event comes at a time`)
      event = token.name
    } else {
      return no(
        `${JSON.stringify(text)}: pack.css takes only :root, [key=value], and the events ${EVENTS.map(e => `:${e}`).join(' ')}, with no combinators`,
      )
    }
  }
  return ok({ attrs, event })
}

function parseNames(value: string): Parsed<readonly string[]> {
  const names = value.split(/[\s,]+/).filter(n => n !== '')
  const bad = names.find(n => !NAME.test(n))
  if (names.length === 0) return no('names no channel')
  return bad === undefined ? ok(names) : no(`${JSON.stringify(bad)} is not a name`)
}

function parseWeighted(value: string): Parsed<Weighted> {
  const weights: Record<string, number> = {}
  for (const item of value.split(',')) {
    const [name = '', weight = '1', ...more] = item.trim().split(/\s+/)
    if (more.length > 0 || !NAME.test(name)) return no(`${JSON.stringify(item.trim())} is not "motion" or "motion weight"`)
    const w = /^\d{1,3}$/.test(weight) ? Number(weight) : Number.NaN
    if (!(w >= 1 && w <= MAX_WEIGHT)) return no(`the weight of ${name} is not a whole number from 1 to ${MAX_WEIGHT}`)
    if (Object.hasOwn(weights, name)) return no(`${name} is in the list twice`)
    weights[name] = w
  }
  return ok(weights)
}

function parseDuration(text: string): number | null {
  const match = DURATION.exec(text)
  if (match === null) return null
  return Math.round(Number(match[1]) * (match[2] === 's' ? 1000 : 1))
}

function parseIdleEvery(value: string): Parsed<readonly [number, number]> {
  const parts = value.split(/\s+/).filter(p => p !== '')
  const [min, max = min] = parts.map(parseDuration)
  if (parts.length > 2 || min === undefined || min === null || max === undefined || max === null) {
    return no('is a time, or a shortest and a longest time, for example 8s 20s')
  }
  if (min < 1000 || max < min) return no('the times are at least 1s, and the second is not shorter than the first')
  return ok([min, max])
}

type Mutable = {
  pose: Record<string, string>
  lock: string[]
  play?: string
  tricks?: Weighted
  once?: Weighted
  idleEvery?: readonly [number, number]
}

function declare(set: Mutable, property: string, value: string, event: Event | null): string | null {
  if (/!\s*important\s*$/i.test(value)) return '!important is not supported: make the rule more specific'
  if (property === 'once') {
    if (event === null) return `once plays on an event: put it in a rule with ${EVENTS.map(e => `:${e}`).join(' ')}`
    const parsed = parseWeighted(value)
    if (!parsed.ok) return `once: ${parsed.message}`
    set.once = parsed.value
    return null
  }
  if (event !== null) return `a rule with :${event} sets only once`
  switch (property) {
    case 'play': {
      if (!NAME.test(value)) return `play: ${JSON.stringify(value)} is not a motion name`
      set.play = value
      return null
    }
    case 'tricks': {
      const parsed = parseWeighted(value)
      if (!parsed.ok) return `tricks: ${parsed.message}`
      set.tricks = parsed.value
      return null
    }
    case 'lock': {
      const parsed = parseNames(value)
      if (!parsed.ok) return `lock: ${parsed.message}`
      set.lock = [...parsed.value]
      return null
    }
    case 'idle-every': {
      const parsed = parseIdleEvery(value)
      if (!parsed.ok) return `idle-every ${parsed.message}`
      set.idleEvery = parsed.value
      return null
    }
    default: {
      if (!NAME.test(property)) return `${JSON.stringify(property)} is not a property of pack.css or a channel name`
      if (!NAME.test(value)) return `${property}: ${JSON.stringify(value)} is not a variant name`
      set.pose[property] = value
      return null
    }
  }
}

const START: Place = { line: 1, column: 1 }

type CssRule = Extract<ReturnType<typeof parse>['stylesheet']['rules'][number], { type: CssTypes.rule }>

// A nested selector is `&` and then conditions or an event: the parent's
// selector with more conditions. `& [x]` would select a descendant, and
// pack.css has no descendants.
function nestedSelector(text: string, parent: Selector): Parsed<Selector> {
  if (!text.startsWith('&') || /^&\s/.test(text)) {
    return no(`${JSON.stringify(text)}: a nested selector is & and then conditions or an event, for example &[state=working]`)
  }
  const own = parseOneSelector(text.slice(1))
  if (!own.ok) return own
  const attrs: Record<string, string> = { ...parent.attrs }
  for (const [key, value] of Object.entries(own.value.attrs)) {
    if (Object.hasOwn(attrs, key)) return no(`${JSON.stringify(text)} names ${key} again under a rule that names it, so it never holds`)
    attrs[key] = value
  }
  if (parent.event !== null && own.value.event !== null)
    return no(`${JSON.stringify(text)} waits for a second event; one event comes at a time`)
  return ok({ attrs, event: own.value.event ?? parent.event })
}

function readRule(node: CssRule, parent: Selector | null, rules: Rule[], errors: RuleError[]): void {
  const at = node.position?.start ?? START
  const selectors = node.selectors.map(text => (parent === null ? parseOneSelector(text) : nestedSelector(text, parent)))
  const bad = selectors.find((s): s is Extract<Parsed<Selector>, { ok: false }> => !s.ok)
  if (bad !== undefined) {
    errors.push({ ...at, message: bad.message })
    return
  }
  for (const parsed of selectors) {
    if (!parsed.ok) continue
    const selector = parsed.value
    const set: Mutable = { pose: {}, lock: [] }
    const places: Record<string, Place> = {}
    const nested: CssRule[] = []
    let failed = false
    for (const decl of node.declarations) {
      const place = decl.position?.start ?? at
      if (decl.type === CssTypes.comment) continue
      if (decl.type === CssTypes.rule) {
        nested.push(decl)
        continue
      }
      if (decl.type !== CssTypes.declaration) {
        errors.push({ ...place, message: `@${decl.type} is not supported: a rule holds declarations and nested rules` })
        failed = true
        continue
      }
      // CSS lets a later declaration win; here the intent must be one line.
      if (Object.hasOwn(places, decl.property)) {
        errors.push({ ...place, message: `${decl.property} is set twice in this rule` })
        failed = true
        continue
      }
      places[decl.property] = place
      const problem = declare(set, decl.property, decl.value.trim(), selector.event)
      if (problem !== null) {
        errors.push({ ...place, message: problem })
        failed = true
      }
    }
    if (!failed) {
      const specificity = Object.keys(selector.attrs).length + (selector.event === null ? 0 : 1)
      rules.push({ selector, specificity, set, at, places })
    }
    // As in CSS, a nested rule comes after its parent: on a tie it wins.
    for (const child of nested) readRule(child, selector, rules, errors)
  }
}

/**
 * Parses `pack.css`. A rule with an error is left out; each error has its
 * line and column. A nested rule (`&[state=working] { ... }` in a rule) is
 * one more rule: the parent's conditions and its own.
 */
export function parseRules(text: string): { rules: readonly Rule[]; errors: readonly RuleError[] } {
  const sheet = parse(text, { silent: true })
  const errors: RuleError[] = (sheet.stylesheet.parsingErrors ?? []).map(e => ({ line: e.line, column: e.column, message: e.reason }))
  const rules: Rule[] = []
  for (const node of sheet.stylesheet.rules) {
    if (node.type === CssTypes.comment) continue
    if (node.type !== CssTypes.rule) {
      errors.push({ ...(node.position?.start ?? START), message: `@${node.type} is not supported: pack.css takes only rules` })
      continue
    }
    readRule(node, null, rules, errors)
  }
  return { rules, errors }
}

// The checks that need the pack: each name in a rule must be in it.
export function checkRules(pack: Pack, rules: readonly Rule[]): readonly RuleError[] {
  const errors: RuleError[] = []
  const motion = (name: string, place: Place): void => {
    if (!Object.hasOwn(pack.motions ?? {}, name) && !Object.hasOwn(BUILTIN_MOTIONS, name)) {
      errors.push({ ...place, message: `${JSON.stringify(name)} is not a motion in the pack or a built-in motion` })
    }
  }
  const channel = (name: string, place: Place): boolean => {
    if (isChannel(pack, name)) return true
    errors.push({ ...place, message: `${JSON.stringify(name)} is not figure, a group, or a part slot, so it is not a channel` })
    return false
  }
  for (const { selector, set, at, places } of rules) {
    for (const [key, value] of Object.entries(selector.attrs)) {
      if (key === 'role') {
        if (!(ROLES as readonly string[]).includes(value))
          errors.push({ ...at, message: `[role=${value}]: the roles are ${ROLES.join(', ')}` })
      } else if (key === 'state') {
        if (!(CHARACTER_STATES as readonly string[]).includes(value)) {
          errors.push({ ...at, message: `[state=${value}]: the states are ${CHARACTER_STATES.join(', ')}` })
        }
      } else if (!Object.hasOwn(pack.parts ?? {}, key)) {
        errors.push({ ...at, message: `[${key}=${value}]: the keys are role, state, and the part slots` })
      } else if (partOf(pack, key, value) === undefined) {
        errors.push({ ...at, message: `[${key}=${value}]: ${JSON.stringify(value)} is not a part in parts.${key}` })
      }
    }
    for (const [name, value] of Object.entries(set.pose)) {
      const place = places[name] ?? at
      if (channel(name, place) && !isChannelValue(pack, name, value)) {
        errors.push({ ...place, message: `${name}: ${JSON.stringify(value)} is not ${BASE} or a variant of ${name}` })
      }
    }
    for (const name of set.lock) channel(name, places.lock ?? at)
    if (set.play !== undefined) motion(set.play, places.play ?? at)
    for (const name of Object.keys(set.tricks ?? {})) motion(name, places.tricks ?? at)
    for (const name of Object.keys(set.once ?? {})) motion(name, places.once ?? at)
  }
  return errors
}

/** A rule error as a pack error: the path names the file, the line, and the column. */
export function ruleErrorOf({ line, column, message }: RuleError): SchemaError {
  return { path: `pack.css:${line}:${column}`, message }
}
