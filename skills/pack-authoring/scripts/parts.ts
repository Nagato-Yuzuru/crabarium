import { isRole } from '../../../hooks/core/avatar/select.ts'
// Library parts: ready-made hats, held items, and back items that fit any
// body with the anchor they name. Pure: the caller reads and writes files.
import { parsePack } from '../../../hooks/core/pack/pack.ts'
import type { Outfit, Pack, ParseResult, Part, Role } from '../../../hooks/core/pack/pack.ts'
import { ROLES } from '../../../hooks/core/pack/schema.ts'

/** A part to add: one of LIBRARY, or a JSON file of the same shape. */
export type LibraryPart = { slot: string; name: string; description: string; part: Part }

export type AddOptions = {
  /** The part name in the pack; the library name when unset. */
  name?: string
  /** The pack anchor to attach to, when the pack names it differently. */
  anchor?: string
  /** Roles that wear the part: it goes into each of their outfits, or makes one. */
  roles?: readonly string[]
  /** Replace a part of the same slot and name. */
  replace?: boolean
}

/** A library part from a JSON file: the fields that name it. `addPart` checks the part itself, as the mod checks a pack. */
export function isLibraryPart(value: unknown): value is LibraryPart {
  return (
    typeof value === 'object' &&
    value !== null &&
    'slot' in value &&
    typeof value.slot === 'string' &&
    'name' in value &&
    typeof value.name === 'string' &&
    'description' in value &&
    typeof value.description === 'string' &&
    'part' in value &&
    typeof value.part === 'object' &&
    value.part !== null
  )
}

/** The palette keys that a part's rows use but its own palette does not give. A library part must give them all. */
export function missingKeys(part: Part): string[] {
  const keys = new Set([part.rows, ...Object.values(part.variants ?? {})].flatMap(rows => rows.flatMap(row => [...row])))
  keys.delete('.')
  return [...keys].filter(key => part.palette?.[key] === undefined)
}

// The outfit with `name` in `slot`; a weight stays only when the outfit has one.
function wear(outfit: Outfit, slot: string, name: string): Outfit {
  const parts = { ...outfit.parts, [slot]: name }
  return outfit.weight === undefined ? { parts } : { parts, weight: outfit.weight }
}

const fail = (path: string, message: string): ParseResult => ({ ok: false, errors: [{ path, message }] })

/** `pack` with the library part added, checked as the mod checks a pack. */
export function addPart(pack: Pack, library: LibraryPart, options: AddOptions = {}): ParseResult {
  const name = options.name ?? library.name
  const slot = pack.parts?.[library.slot] ?? {}
  if (Object.hasOwn(slot, name) && options.replace !== true) {
    return fail(`parts.${library.slot}.${name}`, 'the pack has this part already; pick another name or replace it')
  }
  const roles: Partial<Record<Role, readonly Outfit[]>> = { ...pack.roles }
  for (const role of options.roles ?? []) {
    if (!isRole(role)) return fail('roles', `${JSON.stringify(role)} is not a role; the roles are ${ROLES.join(', ')}`)
    const outfits = roles[role] ?? []
    roles[role] = outfits.length === 0 ? [{ parts: { [library.slot]: name } }] : outfits.map(outfit => wear(outfit, library.slot, name))
  }
  const added = {
    ...pack,
    parts: { ...pack.parts, [library.slot]: { ...slot, [name]: { ...library.part, anchor: options.anchor ?? library.part.anchor } } },
    ...(options.roles === undefined || options.roles.length === 0 ? {} : { roles }),
  }
  // The pack check comes first: it also checks the shape of a part from a file.
  const result = parsePack(added)
  if (!result.ok) return result
  const missing = missingKeys(library.part)
  if (missing.length > 0)
    return fail(`parts.${library.slot}.${name}.palette`, `the part uses keys it does not define: ${missing.join(' ')}`)
  return result
}
