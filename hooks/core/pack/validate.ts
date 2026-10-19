// A validator for the subset of JSON Schema that schema.ts uses. Each keyword
// that the schema uses has a rule here; a keyword with no rule fails loudly, so
// the schema cannot use a keyword that the validator ignores.

export type SchemaError = { path: string; message: string }

type Schema = { readonly [keyword: string]: unknown }

const NOTE_KEYWORDS = new Set(['$schema', '$id', 'title', 'description'])

function typeOf(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'number' && Number.isInteger(value)) return 'integer'
  return typeof value
}

function hasType(value: unknown, type: string): boolean {
  const actual = typeOf(value)
  return actual === type || (type === 'number' && actual === 'integer')
}

function child(path: string, key: string | number): string {
  if (typeof key === 'number') return `${path}[${key}]`
  const plain = /^[A-Za-z_$][\w$-]*$/.test(key)
  if (path === '') return plain ? key : JSON.stringify(key)
  return plain ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`
}

function shown(value: unknown): string {
  // oxlint-disable-next-line typescript/no-unnecessary-condition -- the lib types say string, but JSON.stringify gives undefined for undefined and functions.
  return JSON.stringify(value) ?? String(value)
}

class Validator {
  readonly errors: SchemaError[] = []
  private readonly root: Schema

  constructor(root: Schema) {
    this.root = root
  }

  private fail(path: string, message: string): void {
    this.errors.push({ path: path === '' ? '(root)' : path, message })
  }

  private resolve(ref: string): Schema {
    const match = /^#\/\$defs\/([\w-]+)$/.exec(ref)
    const defs = this.root.$defs as Record<string, Schema> | undefined
    const target = match === null ? undefined : defs?.[match[1]!]
    if (target === undefined) throw new Error(`schema: unknown $ref ${ref}`)
    return target
  }

  // Returns false when the value failed, so that the caller can stop.
  check(value: unknown, schema: Schema, path: string): boolean {
    const before = this.errors.length
    for (const [keyword, arg] of Object.entries(schema)) {
      if (NOTE_KEYWORDS.has(keyword) || keyword === '$defs') continue
      this.keyword(keyword, arg, value, schema, path)
      // A wrong type makes every other keyword noise.
      if (keyword === 'type' && this.errors.length > before) return false
    }
    return this.errors.length === before
  }

  private keyword(keyword: string, arg: unknown, value: unknown, schema: Schema, path: string): void {
    switch (keyword) {
      case '$ref':
        this.check(value, this.resolve(arg as string), path)
        return
      case 'type':
        if (!hasType(value, arg as string)) this.fail(path, `must be ${arg as string}, not ${typeOf(value)}`)
        return
      case 'const':
        if (value !== arg) this.fail(path, `must be ${shown(arg)}`)
        return
      case 'not': {
        const probe = new Validator(this.root)
        if (probe.check(value, arg as Schema, path)) this.fail(path, `must not be ${shown(value)}`)
        return
      }
      case 'pattern':
        if (typeof value === 'string' && !new RegExp(arg as string, 'u').test(value)) {
          this.fail(path, `${shown(value)} does not match ${arg as string}`)
        }
        return
      case 'minLength':
      case 'maxLength':
        if (typeof value === 'string') this.bound(path, [...value].length, arg as number, keyword, 'characters')
        return
      case 'minimum':
      case 'maximum':
        if (typeof value === 'number') this.bound(path, value, arg as number, keyword, '')
        return
      case 'minItems':
      case 'maxItems':
        if (Array.isArray(value)) this.bound(path, value.length, arg as number, keyword, 'items')
        return
      case 'minProperties':
      case 'maxProperties':
        if (typeOf(value) === 'object') this.bound(path, Object.keys(value as object).length, arg as number, keyword, 'entries')
        return
      case 'items':
        if (Array.isArray(value)) {
          const start = Array.isArray(schema.prefixItems) ? schema.prefixItems.length : 0
          value.slice(start).forEach((item, i) => this.check(item, arg as Schema, child(path, start + i)))
        }
        return
      case 'prefixItems':
        if (Array.isArray(value)) {
          ;(arg as Schema[]).forEach((s, i) => {
            if (i < value.length) this.check(value[i], s, child(path, i))
          })
        }
        return
      case 'required':
        if (typeOf(value) === 'object') {
          for (const key of arg as string[]) {
            if (!Object.hasOwn(value as object, key)) this.fail(child(path, key), 'is required')
          }
        }
        return
      case 'properties':
        if (typeOf(value) === 'object') {
          for (const [key, s] of Object.entries(arg as Record<string, Schema>)) {
            if (Object.hasOwn(value as object, key)) this.check((value as Record<string, unknown>)[key], s, child(path, key))
          }
        }
        return
      case 'propertyNames':
        if (typeOf(value) === 'object') {
          for (const key of Object.keys(value as object)) {
            const probe = new Validator(this.root)
            if (!probe.check(key, arg as Schema, '')) this.fail(child(path, key), `${shown(key)} is not a valid name`)
          }
        }
        return
      case 'additionalProperties':
        if (typeOf(value) === 'object') {
          const known = (schema.properties ?? {}) as Record<string, unknown>
          for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
            if (Object.hasOwn(known, key)) continue
            if (arg === false) this.fail(child(path, key), 'is not a known field')
            else this.check(item, arg as Schema, child(path, key))
          }
        }
        return
      default:
        throw new Error(`schema: the validator has no rule for keyword ${keyword}`)
    }
  }

  private bound(path: string, actual: number, limit: number, keyword: string, unit: string): void {
    const isMin = keyword.startsWith('min')
    if (isMin ? actual >= limit : actual <= limit) return
    const what = unit === '' ? String(limit) : `${limit} ${unit}`
    this.fail(path, `must be ${isMin ? 'at least' : 'at most'} ${what}${unit === '' ? `, not ${actual}` : ` (has ${actual})`}`)
  }
}

/** Every place where `value` breaks `schema`; empty when it is valid. */
export function validateSchema(schema: Schema, value: unknown): SchemaError[] {
  const v = new Validator(schema)
  v.check(value, schema, '')
  return v.errors
}
