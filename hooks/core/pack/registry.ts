// The packs that the user can select: the built-in packs and the user packs.
// Pure: the file texts come in as arguments.
import type { PackFiles } from '../../../types'
import { loadPack } from './load.ts'
import type { LoadResult, PackSource } from './load.ts'
import type { Pack } from './pack.ts'
import type { Rule } from './rules.ts'

export type { PackFiles }

export type PackEntry = { name: string; source: 'built-in' | 'user'; result: LoadResult }

/** The words after `/crabarium pack` that are subcommands, so no pack can have these names. */
export const RESERVED: readonly string[] = ['reload', 'check', 'preview']

// A pack is parsed again only when its texts change. The pane draws often and
// the texts change seldom. The cache drops the least recently used pack, so
// many packs still reuse their results.
const parsed = new Map<string, LoadResult>()
const MAX_PARSED = 128

function parse(source: PackSource): LoadResult {
  // No JSON text holds a NUL character, so the key is one pair of texts.
  const key = source.css === undefined ? source.json : `${source.json}\0${source.css}`
  let result = parsed.get(key)
  if (result === undefined) {
    result = loadPack(source)
    if (parsed.size >= MAX_PARSED) parsed.delete(parsed.keys().next().value!)
  } else {
    parsed.delete(key)
  }
  parsed.set(key, result)
  return result
}

function userEntry(name: string, file: PackFiles['packs'][string]): PackEntry {
  if (RESERVED.includes(name)) {
    return {
      name,
      source: 'user',
      result: {
        ok: false,
        errors: [{ path: '(directory)', message: `${JSON.stringify(name)} is a word of /crabarium pack; rename the directory` }],
      },
    }
  }
  if ('error' in file) return { name, source: 'user', result: { ok: false, errors: [{ path: '(file)', message: file.error }] } }
  const result = parse(file.css === undefined ? { json: file.text } : { json: file.text, css: file.css.text })
  // The directory names the pack, so `name` in the file must agree with it.
  if (result.ok && result.pack.name !== name) {
    return {
      name,
      source: 'user',
      result: {
        ok: false,
        errors: [{ path: 'name', message: `is ${JSON.stringify(result.pack.name)}, but the directory is ${JSON.stringify(name)}` }],
      },
    }
  }
  return { name, source: 'user', result }
}

/** Each pack by name, sorted. A user pack replaces a built-in pack with the same name. */
export function packEntries(builtins: Readonly<Record<string, PackSource>>, files: PackFiles): readonly PackEntry[] {
  const entries = new Map<string, PackEntry>()
  for (const [name, source] of Object.entries(builtins)) entries.set(name, { name, source: 'built-in', result: parse(source) })
  for (const [name, file] of Object.entries(files.packs)) entries.set(name, userEntry(name, file))
  return [...entries.values()].toSorted((a, b) => a.name.localeCompare(b.name))
}

/** The pack to draw with, and why it is not the one asked for (`null` when it is). */
export type ActivePack = { name: string; pack: Pack; rules: readonly Rule[]; problem: string | null }

/**
 * The asked-for pack when it is valid, else the fallback pack. The fallback is
 * a built-in pack, which the tests parse, so it is always valid.
 */
export function activePack(
  entries: readonly PackEntry[],
  wanted: string,
  fallback: { name: string; pack: Pack; rules: readonly Rule[] },
): ActivePack {
  const entry = entries.find(e => e.name === wanted)
  if (entry?.result.ok === true) return { name: entry.name, pack: entry.result.pack, rules: entry.result.rules, problem: null }
  const problem =
    entry === undefined
      ? `pack ${JSON.stringify(wanted)} is not installed`
      : `pack ${JSON.stringify(wanted)} is not valid: run /crabarium pack check ${wanted}`
  return { ...fallback, problem }
}
