// Reads the user packs. The mod only lists, stats and reads in the packs
// directory; it never writes there. A pack is untrusted data, and nothing in
// it runs as code.
import type { EngineInterface } from 'claude-code'

import type { PackFiles } from './core/pack/registry.ts'

/** No user packs, and no directory found yet. */
export const NO_PACK_FILES: PackFiles = { dir: null, packs: {} }

/** A variable's value; an empty one counts as unset. */
function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === '' ? undefined : value
}

/**
 * The packs directory: `crabarium/packs` in the Claude configuration
 * directory, which is `CLAUDE_CONFIG_DIR` when it is set, else `.claude` in
 * the home directory. `null` when the mod cannot find either.
 */
export async function packsDir($: EngineInterface): Promise<string | null> {
  const [config, profile, home] = await Promise.all([$.env.get('CLAUDE_CONFIG_DIR'), $.env.get('USERPROFILE'), $.env.get('HOME')])
  // USERPROFILE comes first, as in Node's homedir() on Windows.
  const base = nonEmpty(config) ?? (nonEmpty(profile) ?? nonEmpty(home))?.concat('/.claude')
  return base === undefined ? null : `${base.replace(/[\\/]+$/, '')}/crabarium/packs`
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Reads each `<dir>/<name>/pack.json`. A pack whose file time did not change
 * keeps its text from `previous`, so a check reads only what changed. A
 * missing directory is no packs.
 */
export async function scanPacks($: EngineInterface, previous: PackFiles): Promise<PackFiles> {
  const dir = await packsDir($)
  if (dir === null) return NO_PACK_FILES
  const entries = await $.fs.list(dir).catch(() => [])
  const kept = dir === previous.dir ? previous.packs : {}
  const packs = await Promise.all(
    entries
      .filter(e => e.kind === 'dir' || e.isLink)
      .map(async ({ name }): Promise<[string, PackFiles['packs'][string]] | null> => {
        const file = `${dir}/${name}/pack.json`
        const stat = await $.fs.stat(file).catch(() => null)
        // A directory with no pack.json is not a pack.
        if (stat === null || stat.kind !== 'file') return null
        // A read error is read again: a fix of the file mode does not change its time.
        const old = kept[name]
        if (old !== undefined && 'text' in old && old.mtimeMs === stat.mtimeMs && old.size === stat.size) return [name, old]
        const { mtimeMs, size } = stat
        try {
          return [name, { mtimeMs, size, text: await $.fs.read(file) }]
        } catch (error) {
          return [name, { mtimeMs, size, error: message(error) }]
        }
      }),
  )
  return { dir, packs: Object.fromEntries(packs.filter(p => p !== null)) }
}

/** Whether two scans hold the same files, so that an unchanged scan does not redraw the pane. */
export function samePackFiles(a: PackFiles, b: PackFiles): boolean {
  const names = Object.keys(a.packs)
  return (
    a.dir === b.dir &&
    names.length === Object.keys(b.packs).length &&
    names.every(n => {
      const [x, y] = [a.packs[n]!, b.packs[n]]
      return y !== undefined && x.mtimeMs === y.mtimeMs && x.size === y.size && 'text' in x === 'text' in y
    })
  )
}
