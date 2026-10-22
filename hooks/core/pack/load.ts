// A pack is `pack.json` and an optional `pack.css`. Pure: the texts come in
// as arguments.
import { parsePackText } from './pack.ts'
import type { Pack, SchemaError } from './pack.ts'
import { checkRules, parseRules, ruleErrorOf } from './rules.ts'
import type { Rule } from './rules.ts'
import { MAX_CSS_CHARS, MAX_PACK_BYTES } from './schema.ts'

/** The texts of a pack's files. */
export type PackSource = { json: string; css?: string }

export type LoadResult = { ok: true; pack: Pack; rules: readonly Rule[] } | { ok: false; errors: readonly SchemaError[] }

/** Checks both files. Each error names the field, or the line and column in pack.css. */
export function loadPack(source: PackSource): LoadResult {
  // UTF-16 code units: at most the UTF-8 bytes for ASCII, the text a pack is.
  const size = source.json.length + (source.css?.length ?? 0)
  if (size > MAX_PACK_BYTES) {
    return {
      ok: false,
      errors: [{ path: '(files)', message: `pack.json and pack.css have ${size} characters; the limit is ${MAX_PACK_BYTES}` }],
    }
  }
  if ((source.css?.length ?? 0) > MAX_CSS_CHARS) {
    return { ok: false, errors: [{ path: 'pack.css', message: `has ${source.css?.length} characters; the limit is ${MAX_CSS_CHARS}` }] }
  }
  const result = parsePackText(source.json)
  const css = source.css === undefined ? { rules: [], errors: [] } : parseRules(source.css)
  if (!result.ok) return { ok: false, errors: [...result.errors, ...css.errors.map(ruleErrorOf)] }
  const errors = [...css.errors, ...checkRules(result.pack, css.rules)].map(ruleErrorOf)
  return errors.length > 0 ? { ok: false, errors } : { ok: true, pack: result.pack, rules: css.rules }
}
