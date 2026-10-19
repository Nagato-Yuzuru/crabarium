// Avatar selection: which outfit an agent wears. Pure: the pack, the agent
// and the settings come in as arguments.
//
// The sources give a role or outfits, and the pack gives the parts. A role is
// a closed set, so the same keyword and type tables work for each pack, and a
// classifier (a later source) answers one choice over the roles. The sources
// go in priority order and the first valid result wins; no source mixes
// scores with another.
import { own } from '../own'
import { partOf } from '../pack/pack'
import type { Outfit, Pack, PartSelection, Role } from '../pack/pack'
import { ROLES } from '../pack/schema'

/** `off` turns off the automatic sources (keywords, type defaults). User rules still apply. */
export type AvatarMode = 'off' | 'keywords'

const AVATAR_MODES: readonly unknown[] = ['off', 'keywords'] satisfies AvatarMode[]

/** The `avatarMode` option. The engine gives only the manifest's values, so another value is a bug; it falls back to `keywords`. */
export function avatarMode(option: unknown): AvatarMode {
  return AVATAR_MODES.includes(option) ? (option as AvatarMode) : 'keywords'
}

/** What the selector reads of an agent. */
export type AgentInfo = { id: string; type: string; description: string }

/** What a rule gives: a role, which the pack dresses, or outfits by part name. */
export type Target = { kind: 'role'; role: Role } | { kind: 'outfits'; outfits: readonly Outfit[] }

export type Rule = { pattern: string; target: Target }

export type RuleError = { rule: string; message: string }

/** Where a choice came from. */
export type Source = 'rule' | 'keywords' | 'type' | 'default'

export type Choice = { source: Source; role: Role | null; parts: PartSelection }

const PART_NAME = /^[a-zA-Z][a-zA-Z0-9-]{0,31}$/

function isRole(text: string): text is Role {
  return (ROLES as readonly string[]).includes(text)
}

function parseOutfit(text: string): Outfit | string {
  const outfit = text.trim()
  const [body = '', weightText, ...rest] = outfit.split('*')
  if (rest.length > 0) return `${JSON.stringify(outfit)} has more than one "*"`
  // Digits only: Number() would also take 1e2, 0x10 and 1.0.
  const weight = weightText === undefined ? 1 : /^\s*\d{1,3}\s*$/.test(weightText) ? Number(weightText) : Number.NaN
  if (!(weight >= 1 && weight <= 100)) return `the weight in ${JSON.stringify(outfit)} is not a whole number from 1 to 100`
  const parts: Record<string, string> = {}
  for (const token of body.split(/\s+/).filter(t => t !== '')) {
    const [slot = '', part = '', ...more] = token.split(':')
    if (more.length > 0 || !PART_NAME.test(slot) || !PART_NAME.test(part)) return `${JSON.stringify(token)} is not slot:part`
    if (Object.hasOwn(parts, slot)) return `${JSON.stringify(outfit)} names the slot ${JSON.stringify(slot)} twice`
    parts[slot] = part
  }
  if (Object.keys(parts).length === 0) return `${JSON.stringify(outfit)} names no part`
  return { parts, weight }
}

/**
 * Parses the `avatarRules` option: `pattern = target; pattern = target`. A
 * target is a role, or outfits `slot:part slot:part*weight | ...`. A rule
 * that does not parse is left out, with an error that names it.
 */
export function parseRules(text: string): { rules: readonly Rule[]; errors: readonly RuleError[] } {
  const rules: Rule[] = []
  const errors: RuleError[] = []
  for (const raw of text.split(';')) {
    const rule = raw.trim()
    if (rule === '') continue
    const at = rule.indexOf('=')
    const pattern = at < 0 ? '' : rule.slice(0, at).trim().toLowerCase()
    const target = at < 0 ? '' : rule.slice(at + 1).trim()
    if (at < 0 || pattern === '' || /\s/.test(pattern) || target === '') {
      errors.push({ rule, message: 'is not "pattern = target"' })
      continue
    }
    if (isRole(target)) {
      rules.push({ pattern, target: { kind: 'role', role: target } })
      continue
    }
    const outfits = target.split('|').map(parseOutfit)
    const bad = outfits.find(o => typeof o === 'string')
    if (bad !== undefined) {
      errors.push({ rule, message: `${bad}, and ${JSON.stringify(target)} is not a role (${ROLES.join(', ')})` })
      continue
    }
    rules.push({ pattern, target: { kind: 'outfits', outfits: outfits as Outfit[] } })
  }
  return { rules, errors }
}

/** The words of a description, lower case. A hyphenated word stays one word: a rule pattern can name it. */
function wordsOf(description: string): readonly string[] {
  return description
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .filter(w => w !== '')
}

/**
 * The stem of a word, so that a keyword matches its common forms: review,
 * reviews, reviewing, reviewer; write, writing; plan, planner, planning. It
 * cuts one ending (when three letters stay), then a doubled last consonant,
 * then a last "e".
 */
export function stem(word: string): string {
  let w = word.toLowerCase()
  const ending = ['ings', 'ing', 'ers', 'er', 'ed', 'es', 's'].find(e => w.endsWith(e) && w.length - e.length >= 3)
  if (ending !== undefined) w = w.slice(0, -ending.length)
  if (/([b-df-hj-np-tv-z])\1$/.test(w)) w = w.slice(0, -1)
  return w.endsWith('e') && w.length > 3 ? w.slice(0, -1) : w
}

// The verbs that tell a role. The first one in a description gives the role,
// as the verb leads a task ("Review the loop").
const KEYWORDS: Readonly<Record<Role, readonly string[]>> = {
  explorer: ['explore', 'find', 'search', 'locate', 'read', 'list', 'grep', 'scan', 'map', 'trace'],
  reviewer: ['review', 'audit', 'critique', 'inspect'],
  builder: ['write', 'implement', 'build', 'fix', 'refactor', 'add', 'create', 'update', 'change', 'port', 'migrate'],
  tester: ['test', 'verify', 'check', 'validate', 'reproduce', 'measure'],
  planner: ['plan', 'design', 'outline', 'decide', 'draft'],
  researcher: ['research', 'fetch', 'docs', 'documentation', 'web', 'summarize', 'compare'],
}

const ROLE_OF_STEM: ReadonlyMap<string, Role> = new Map(ROLES.flatMap(role => KEYWORDS[role].map(k => [stem(k), role] as const)))

/** The role of the first keyword in `words`. A hyphenated word counts as its parts: code-review has review. */
function keywordRole(words: readonly string[]): Role | null {
  for (const word of words.flatMap(w => w.split('-'))) {
    const role = ROLE_OF_STEM.get(stem(word))
    if (role !== undefined) return role
  }
  return null
}

// The agent types of Claude Code and of common plugins by their whole name.
const TYPE_ROLES: Readonly<Record<string, Role>> = {
  explore: 'explorer',
  coder: 'builder',
  oracle: 'tester',
  architect: 'planner',
  plan: 'planner',
  fetcher: 'researcher',
  'web-fetch': 'researcher',
}

/** The role of a type: by its whole name, else by the keywords among its words (linus-reviewer, docs-fetcher). */
function typeRole(type: string): Role | null {
  const name = type.toLowerCase()
  return own(TYPE_ROLES, name) ?? keywordRole(name.split(/[^a-z0-9]+/).filter(w => w !== ''))
}

/** FNV-1a: a small, stable hash, so the same agent picks the same outfit at each draw. */
function hash(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0
  return h
}

/**
 * One of the outfits whose parts the pack has, by weight, seeded by `seed`;
 * `null` when none fits. An outfit fills its slots, and the pack defaults
 * fill the others.
 */
export function pickOutfit(pack: Pack, outfits: readonly Outfit[], seed: string): PartSelection | null {
  const fits = outfits.filter(o => Object.entries(o.parts).every(([slot, name]) => partOf(pack, slot, name) !== undefined))
  const total = fits.reduce((sum, o) => sum + (o.weight ?? 1), 0)
  if (total === 0) return null
  let left = hash(seed) % total
  for (const outfit of fits) {
    left -= outfit.weight ?? 1
    if (left < 0) return { ...pack.defaults?.parts, ...outfit.parts }
  }
  return null
}

function dress(pack: Pack, role: Role | null, seed: string): PartSelection | null {
  const outfits = role === null ? undefined : pack.roles?.[role]
  return outfits === undefined ? null : pickOutfit(pack, outfits, seed)
}

function matches(rule: Rule, agent: AgentInfo, words: readonly string[]): boolean {
  return agent.type.toLowerCase() === rule.pattern || words.includes(rule.pattern)
}

export type Settings = { mode: AvatarMode; rules: readonly Rule[] }

/**
 * The outfit of an agent. The sources in order: the first user rule that
 * matches; then, when the mode is `keywords`, the description keywords and
 * the agent type; then the pack's default parts. A source whose result the
 * pack cannot dress gives nothing, and the next source runs.
 */
export function selectOutfit(pack: Pack, agent: AgentInfo, settings: Settings): Choice {
  const words = wordsOf(agent.description)
  const rule = settings.rules.find(r => matches(r, agent, words))
  if (rule !== undefined) {
    const { target } = rule
    const role = target.kind === 'role' ? target.role : null
    const parts = target.kind === 'role' ? dress(pack, role, agent.id) : pickOutfit(pack, target.outfits, agent.id)
    if (parts !== null) return { source: 'rule', role, parts }
  }
  if (settings.mode === 'keywords') {
    for (const [source, role] of [
      ['keywords', keywordRole(words)],
      ['type', typeRole(agent.type)],
    ] as const) {
      const parts = dress(pack, role, agent.id)
      if (parts !== null) return { source, role, parts }
    }
  }
  return { source: 'default', role: null, parts: pack.defaults?.parts ?? {} }
}
