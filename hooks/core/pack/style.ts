// The style of an agent: what the rules of its pack give for its role, its
// parts, and its state. Pure, as in CSS: the rules that match apply from the
// least specific to the most specific, and on a tie the later rule wins.
// `states` in pack.json and the default motions are rules too, before
// pack.css, so a pack with no pack.css keeps its behavior.
import { own } from '../own.ts'
import { BUILTIN_MOTIONS, DEFAULT_STATES } from './motions.ts'
import type { CharacterState, Motion, Pack, PartSelection, Role } from './pack.ts'
import type { Event, Rule, Weighted } from './rules.ts'

/** What the rules match: `[role=…]`, `[state=…]`, and `[<slot>=<part>]`. */
export type Tags = { role: Role | null; state: CharacterState; parts: PartSelection }

export type Style = {
  /** The base pose: a value for each channel that a rule names. */
  pose: Readonly<Record<string, string>>
  locks: ReadonlySet<string>
  /** The loop of track 0, or `null` for no motion. */
  play: string | null
  tricks: Weighted
  once: Readonly<Partial<Record<Event, Weighted>>>
  idleEvery: readonly [minMs: number, maxMs: number] | null
}

const NO_PLACE = { line: 0, column: 0 }

function shorthand(states: Readonly<Partial<Record<CharacterState, string>>>): Rule[] {
  return Object.entries(states).map(([state, play]) => ({
    selector: { attrs: { state }, event: null },
    specificity: 1,
    set: { pose: {}, lock: [], play },
    at: NO_PLACE,
    places: {},
  }))
}

function matches(rule: Rule, tags: Tags): boolean {
  return Object.entries(rule.selector.attrs).every(([key, value]) => {
    if (key === 'role') return tags.role === value
    if (key === 'state') return tags.state === value
    return own(tags.parts, key) === value
  })
}

// The rules of a pack in their cascade order, made once for each rule list.
const cascades = new WeakMap<Pack, WeakMap<readonly Rule[], readonly Rule[]>>()

function cascade(pack: Pack, rules: readonly Rule[]): readonly Rule[] {
  let byRules = cascades.get(pack)
  if (byRules === undefined) {
    byRules = new WeakMap()
    cascades.set(pack, byRules)
  }
  let ordered = byRules.get(rules)
  if (ordered === undefined) {
    const all = [...shorthand(DEFAULT_STATES), ...shorthand(pack.states ?? {}), ...rules]
    // toSorted is stable, so equal specificities keep their order and the later one wins.
    ordered = all.toSorted((a, b) => a.specificity - b.specificity)
    byRules.set(rules, ordered)
  }
  return ordered
}

export function styleOf(pack: Pack, rules: readonly Rule[], tags: Tags): Style {
  const pose: Record<string, string> = {}
  const locked: Record<string, string> = {}
  const locks = new Set<string>()
  const tricks: Record<string, number> = {}
  const once: Partial<Record<Event, Weighted>> = {}
  let play: string | null = null
  let idleEvery: Style['idleEvery'] = null
  for (const rule of cascade(pack, rules)) {
    if (!matches(rule, tags)) continue
    const { set } = rule
    if (rule.selector.event !== null) {
      if (set.once !== undefined) once[rule.selector.event] = set.once
      continue
    }
    Object.assign(pose, set.pose)
    for (const channel of set.lock) {
      locks.add(channel)
      // A lock keeps the value of the rule that locks, over a more specific rule.
      const value = own(set.pose, channel)
      if (value !== undefined) locked[channel] = value
    }
    if (set.play !== undefined) play = set.play
    for (const [name, weight] of Object.entries(set.tricks ?? {})) tricks[name] = (tricks[name] ?? 0) + weight
    if (set.idleEvery !== undefined) idleEvery = set.idleEvery
  }
  return { pose: { ...pose, ...locked }, locks, play, tricks, once, idleEvery }
}

/** A motion of the pack, else a built-in motion with that name. */
export function motionNamed(pack: Pack, name: string): Motion | null {
  return own(pack.motions, name) ?? own(BUILTIN_MOTIONS, name) ?? null
}

/** The loop that a state plays with no role and no parts, or `null` for the still character. */
export function motionOf(pack: Pack, state: CharacterState, rules: readonly Rule[] = []): Motion | null {
  const { play } = styleOf(pack, rules, { role: null, state, parts: {} })
  return play === null ? null : motionNamed(pack, play)
}
