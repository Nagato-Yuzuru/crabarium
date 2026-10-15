/**
 * `record[key]` when the record has that key itself. A pack names its groups,
 * slots and motions, and a name such as `constructor` must not read a method
 * of `Object.prototype`.
 */
export function own<T>(record: Readonly<Record<string, T>> | undefined, key: string): T | undefined {
  return record !== undefined && Object.hasOwn(record, key) ? record[key] : undefined
}
