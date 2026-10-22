// `/crabarium pack ...`: list, select, reload, check and preview packs. The
// text of each answer is pure and tested; the rest reads and writes state.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import { parseRules } from './core/avatar/select.ts'
import type { RuleError } from './core/avatar/select.ts'
import { initialSettings } from './core/avatar/settings.ts'
import type { AvatarSettings } from './core/avatar/settings.ts'
import { packEntries, RESERVED } from './core/pack/registry.ts'
import type { PackEntry, PackFiles } from './core/pack/registry.ts'
import { builtinPacks } from './packs.generated.ts'
import { NO_PACK_FILES, samePackFiles, scanPacks } from './packs.ts'
import { PREVIEW_MS } from './view/preview.ts'

const settings = atom({ plugin: 'crabarium', key: 'settings' } as const, initialSettings)
const packFiles = atom({ plugin: 'crabarium', key: 'packFiles' } as const, NO_PACK_FILES)
const preview = atom({ plugin: 'crabarium', key: 'preview' } as const, null)

/** Reads the user packs again, and writes the state only when a file changed. */
export async function refreshPacks($: EngineInterface): Promise<PackFiles> {
  const old = await read($, packFiles)
  const next = await scanPacks($, old)
  if (!samePackFiles(old, next)) await update($, packFiles, () => next)
  return next
}

function errorCount(entry: PackEntry): number {
  return entry.result.ok ? 0 : entry.result.errors.length
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

/** The answer of `/crabarium pack`: each pack, which one is active, and where user packs go. */
export function packListText(entries: readonly PackEntry[], active: string, dir: string | null, ruleErrors: readonly RuleError[]): string {
  const lines = entries.map(e => {
    const mark = e.name === active ? '●' : ' '
    const state = e.result.ok ? '' : ` · not valid (${plural(errorCount(e), 'error')}): /crabarium pack check ${e.name}`
    return `${mark} ${e.name} (${e.source})${state}`
  })
  if (!entries.some(e => e.name === active)) lines.push(`  ${active} is selected, but it is not installed`)
  lines.push(dir === null ? 'User packs: no home directory found.' : `User packs: ${dir}/<name>/pack.json`)
  if (ruleErrors.length > 0) lines.push(`avatarRules: ${plural(ruleErrors.length, 'rule')} cannot be read: /crabarium pack check`)
  return lines.join('\n')
}

/** The answer of `/crabarium pack check <name>`: each error by field, or a summary of a valid pack. */
export function checkText(entry: PackEntry | undefined, name: string, ruleErrors: readonly RuleError[]): string {
  const lines: string[] = []
  if (entry === undefined) {
    lines.push(`No pack ${JSON.stringify(name)}.`)
  } else if (!entry.result.ok) {
    lines.push(`${entry.name} (${entry.source}) is not valid:`)
    for (const error of entry.result.errors) lines.push(`  ${error.path}: ${error.message}`)
  } else {
    const { pack } = entry.result
    const parts = Object.values(pack.parts ?? {}).reduce((n, named) => n + Object.keys(named).length, 0)
    const roles = Object.keys(pack.roles ?? {})
    lines.push(
      `${entry.name} (${entry.source}) is valid: ${plural(Object.keys(pack.groups).length, 'group')}, ${plural(parts, 'part')}, ` +
        `${plural(Object.keys(pack.motions ?? {}).length, 'motion')}, roles: ${roles.length === 0 ? 'none' : roles.join(', ')}.`,
    )
  }
  for (const error of ruleErrors) lines.push(`avatarRules: ${JSON.stringify(error.rule)} ${error.message}`)
  return lines.join('\n')
}

// The `/config` key of a field of this plugin's `userConfig`: `<plugin>.<field>`,
// where the plugin part can carry a suffix (`@inline` for a --plugin-dir mod).
async function configKey($: EngineInterface, field: string): Promise<string | undefined> {
  const rows = await $.config.list()
  return rows.find(r => r.provider.plugin === $.plugin.name && r.key.endsWith(`.${field}`))?.key
}

/** What a pack command needs from its caller: opening the pane, for a preview. */
export type PackCommandContext = { openPane: () => Promise<void> }

async function select($: EngineInterface, name: string): Promise<string> {
  const entries = packEntries(builtinPacks, await refreshPacks($))
  const entry = entries.find(e => e.name === name)
  if (entry === undefined) return `No pack ${JSON.stringify(name)}. Packs: ${entries.map(e => e.name).join(', ')}.`
  if (!entry.result.ok) return `${name} is not valid, so it stays unselected: /crabarium pack check ${name}`
  const key = await configKey($, 'pack')
  if (key === undefined) return 'crabarium cannot find its pack setting in /config.'
  const result = await $.config.set({ key, value: name })
  if (result.deny !== undefined) return `The pack setting did not change: ${result.deny}`
  // The plugin's own `config.set` hook does not see its own change.
  await update($, settings, s => ({ ...s, pack: name }))
  return `crabarium pack: ${name}`
}

/** Runs `/crabarium pack <args>` and gives the text to show. */
export async function runPackCommand($: EngineInterface, args: readonly string[], context: PackCommandContext): Promise<string> {
  const [sub, name, ...extra] = args
  const config = await read($, settings)
  const { errors } = parseRules(config.avatarRules)
  if (extra.length > 0 || (sub !== undefined && !RESERVED.includes(sub) && name !== undefined)) {
    return 'Usage: /crabarium pack [<name> | reload | check [<name>] | preview [<name>]]'
  }
  switch (sub) {
    case undefined:
    case 'reload': {
      const files = await refreshPacks($)
      return packListText(packEntries(builtinPacks, files), config.pack, files.dir, errors)
    }
    case 'check': {
      const target = name ?? config.pack
      const entries = packEntries(builtinPacks, await refreshPacks($))
      return checkText(
        entries.find(e => e.name === target),
        target,
        errors,
      )
    }
    case 'preview': {
      if (name === undefined) {
        await update($, preview, () => null)
        return 'The preview ended.'
      }
      const entry = packEntries(builtinPacks, await refreshPacks($)).find(e => e.name === name)
      if (entry === undefined) return `No pack ${JSON.stringify(name)}.`
      if (!entry.result.ok) return `${name} is not valid: /crabarium pack check ${name}`
      const now = await $.clock.now()
      await update($, preview, () => ({ pack: name, startedAt: now, until: now + PREVIEW_MS }))
      await context.openPane()
      return `Preview of ${name} for ${PREVIEW_MS / 1000} s. /crabarium pack preview ends it.`
    }
    default:
      return select($, sub)
  }
}

/** Updates a setting when the user changes this plugin's row in `/config`. */
export async function settingChanged($: EngineInterface, key: string, value: unknown): Promise<void> {
  const field = key.slice(key.lastIndexOf('.') + 1)
  const change: Partial<AvatarSettings> | null =
    field === 'pack' && typeof value === 'string'
      ? { pack: value.trim() === '' ? initialSettings.pack : value.trim() }
      : field === 'avatarMode' && (value === 'off' || value === 'keywords')
        ? { avatarMode: value }
        : field === 'avatarRules' && typeof value === 'string'
          ? { avatarRules: value }
          : null
  if (change !== null) await update($, settings, s => ({ ...s, ...change }))
}
