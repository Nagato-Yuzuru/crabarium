import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { describe, expect, mock, test } from 'claude-code/testing'

import { checkText, packListText } from '../hooks/commands'
import { parseRules } from '../hooks/core/avatar/select'
import { activePack, packEntries } from '../hooks/core/pack/registry'
import { samePackFiles } from '../hooks/packs'
import { builtinPackTexts } from '../hooks/packs.generated'
import { PANE_ID } from '../hooks/state'
import { fallbackPack } from '../hooks/view/avatar'
import { validPack } from './fixtures/packs'

const HOME = '/home/u'
const DIR = `${HOME}/.claude/crabarium/packs`

function packText(name: string, change: (p: Record<string, unknown>) => void = () => undefined): string {
  const pack: Record<string, unknown> = structuredClone({ ...validPack, name })
  change(pack)
  return JSON.stringify(pack)
}

// A file system beneath the plugin: files by path, each with a time. It
// records each read and each write; the mod must never write. A file with
// `deny` refuses its reads with that reason.
type FakeFile = { text: string; mtimeMs: number; deny?: string }
function fakeFs(on: On, files: Record<string, FakeFile>) {
  const log = { reads: [] as string[], writes: [] as string[] }
  const dirs = (path: string) =>
    new Set(
      Object.keys(files)
        .filter(f => f.startsWith(`${path}/`))
        .map(f => f.slice(path.length + 1).split('/')[0]!),
    )
  on('fs.list', async (_$, e) => {
    const names = [...dirs(e.path)]
    return {
      value: names.map(name => ({
        name,
        kind: Object.hasOwn(files, `${e.path}/${name}`) ? 'file' : 'dir',
        size: 0,
        mtimeMs: 0,
        isLink: false,
      })),
    } as never
  })
  on('fs.stat', async (_$, e) => {
    const file = files[e.path]
    return (
      file === undefined ? { deny: 'ENOENT' } : { value: { kind: 'file', size: file.text.length, mtimeMs: file.mtimeMs, isLink: false } }
    ) as never
  })
  on('fs.read', async (_$, e) => {
    log.reads.push(e.path)
    const file = files[e.path]
    return (file === undefined ? { deny: 'ENOENT' } : file.deny !== undefined ? { deny: file.deny } : { value: file.text }) as never
  })
  on('fs.write', async (_$, e) => {
    log.writes.push(e.path)
    return { value: undefined } as never
  })
  return log
}

// The engine beneath: a home directory, the plugin's /config rows, and a pane that opens.
function engine(on: On) {
  mock.env(on, { HOME })
  const log = { configSets: [] as { key: string; value: unknown }[], opened: 0 }
  let open = false
  on(
    'config.list',
    async () =>
      ({
        value: [
          {
            key: 'crabarium.pack',
            label: 'Character pack',
            kind: 'text',
            value: 'minimal',
            provider: { plugin: 'crabarium', tier: 'user' },
            isLocked: false,
          },
        ],
      }) as never,
  )
  on('config.set', async (_$, e) => {
    log.configSets.push({ key: e.key, value: e.value })
    return { value: e.value }
  })
  on(
    'ui.panes',
    async () => ({ value: open ? [{ id: PANE_ID, title: 'crabarium', isShown: true, isFocused: false, isPlaced: true }] : [] }) as never,
  )
  on('ui.open', async () => {
    open = true
    log.opened += 1
    return { value: { isPlaced: true } } as never
  })
  on('session.usage', async () => ({ value: { startedAt: 0, context: { window: 1_000_000 }, rateLimits: [] } }) as never)
  on('session.turns', async () => ({ value: 0 }) as never)
  on('agent.list', async () => ({ value: [] }) as never)
  return log
}

async function packCommand($: Engine, args: string): Promise<string> {
  return (await $.command.run({ command: 'crabarium', args: `pack ${args}`.trim() } as never)).text ?? ''
}

async function paneTexts($: Engine): Promise<string[]> {
  const pane = await $.ui.mount({
    plugin: 'crabarium',
    surface: 'terminal',
    component: 'Pane',
    requestId: PANE_ID,
    props: { title: 'crabarium', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  })
  const texts = (await pane.findAll({ type: 'Text' })).map(t => String(t.text))
  await pane.unmount()
  return texts
}

describe('packEntries and activePack', () => {
  const files = {
    dir: DIR,
    packs: {
      minimal: { mtimeMs: 1, size: 1, text: packText('minimal') },
      mine: { mtimeMs: 1, size: 1, text: packText('other') },
      broken: { mtimeMs: 1, size: 1, error: 'too large' },
    },
  }
  const entries = packEntries(builtinPackTexts, files)

  test('a user pack replaces the built-in pack with the same name; the list is sorted', () => {
    expect(entries.map(e => `${e.name}:${e.source}`)).toEqual(['broken:user', 'mine:user', 'minimal:user'])
  })

  test('a pack whose name is not its directory name is not valid, and the error names the field', () => {
    const mine = entries.find(e => e.name === 'mine')!
    expect(mine.result.ok ? [] : mine.result.errors).toEqual([{ path: 'name', message: 'is "other", but the directory is "mine"' }])
  })

  test('an invalid or missing pack falls back, and says why', () => {
    const fallback = fallbackPack()
    expect(activePack(entries, 'minimal', fallback).problem).toBeNull()
    expect(activePack(entries, 'broken', fallback)).toMatchObject({
      name: 'minimal',
      problem: 'pack "broken" is not valid: run /crabarium pack check broken',
    })
    expect(activePack(entries, 'gone', fallback).problem).toBe('pack "gone" is not installed')
  })

  test('the list marks the active pack, the invalid packs, and the rule errors', () => {
    const text = packListText(entries, 'minimal', DIR, parseRules('x = wizard').errors)
    expect(text.split('\n')).toEqual([
      '  broken (user) · not valid (1 error): /crabarium pack check broken',
      '  mine (user) · not valid (1 error): /crabarium pack check mine',
      '● minimal (user)',
      `User packs: ${DIR}/<name>/pack.json`,
      'avatarRules: 1 rule cannot be read: /crabarium pack check',
    ])
  })

  test('check names each error by field, or sums up a valid pack', () => {
    expect(
      checkText(
        entries.find(e => e.name === 'mine'),
        'mine',
        [],
      ),
    ).toBe('mine (user) is not valid:\n  name: is "other", but the directory is "mine"')
    expect(
      checkText(
        packEntries(builtinPackTexts, { dir: null, packs: {} }).find(e => e.name === 'minimal'),
        'minimal',
        [],
      ),
    ).toBe('minimal (built-in) is valid: 6 groups, 4 parts, 2 motions, roles: explorer, researcher, reviewer, builder, tester, planner.')
    expect(checkText(undefined, 'gone', [])).toBe('No pack "gone".')
  })
})

describe('/crabarium pack', () => {
  test('lists the built-in and the user packs, and finds the user packs directory from HOME', async ($, on) => {
    mock.clock(on, { now: 0 })
    engine(on)
    fakeFs(on, { [`${DIR}/mine/pack.json`]: { text: packText('mine'), mtimeMs: 1 }, [`${DIR}/empty/readme.txt`]: { text: '', mtimeMs: 1 } })
    expect((await packCommand($, '')).split('\n')).toEqual(['  mine (user)', '● minimal (built-in)', `User packs: ${DIR}/<name>/pack.json`])
  })

  test('reads a pack file again only when its time changes', async ($, on) => {
    mock.clock(on, { now: 0 })
    engine(on)
    const files = { [`${DIR}/mine/pack.json`]: { text: packText('mine'), mtimeMs: 1 } }
    const log = fakeFs(on, files)
    await packCommand($, 'reload')
    await packCommand($, 'reload')
    expect(log.reads).toHaveLength(1)
    files[`${DIR}/mine/pack.json`] = { text: packText('mine'), mtimeMs: 2 }
    await packCommand($, 'reload')
    expect(log.reads).toHaveLength(2)
  })

  test('selects a valid pack through /config, and refuses an invalid or unknown one', async ($, on) => {
    mock.clock(on, { now: 0 })
    const log = engine(on)
    fakeFs(on, {
      [`${DIR}/mine/pack.json`]: { text: packText('mine'), mtimeMs: 1 },
      [`${DIR}/bad/pack.json`]: { text: '{', mtimeMs: 1 },
    })
    expect(await packCommand($, 'mine')).toBe('crabarium pack: mine')
    expect(log.configSets).toEqual([{ key: 'crabarium.pack', value: 'mine' }])
    expect((await packCommand($, '')).split('\n')[1]).toBe('● mine (user)')
    expect(await packCommand($, 'bad')).toBe('bad is not valid, so it stays unselected: /crabarium pack check bad')
    expect(await packCommand($, 'gone')).toBe('No pack "gone". Packs: bad, mine, minimal.')
    expect(log.configSets).toHaveLength(1)
  })

  test('check with no name checks the active pack, and reports the rules that do not parse', async ($, on) => {
    mock.clock(on, { now: 0 })
    engine(on)
    fakeFs(on, {})
    expect(await packCommand($, 'check')).toMatch(/^minimal \(built-in\) is valid/)
    expect(await packCommand($, 'check nope')).toBe('No pack "nope".')
    expect(await packCommand($, 'too many words here')).toMatch(/^Usage:/)
  })

  test('preview opens the pane and shows each state and each role of the pack, then ends', async ($, on) => {
    const clock = mock.clock(on, { now: 0 })
    const log = engine(on)
    fakeFs(on, {})
    expect(await packCommand($, 'preview minimal')).toBe('Preview of minimal for 60 s. /crabarium pack preview ends it.')
    expect(log.opened).toBe(1)
    const texts = await paneTexts($)
    expect(texts).toContain('Preview minimal')
    expect(texts.filter(t => /^(state|role) /.test(t))).toEqual([
      'state working',
      'state idle',
      'state finished',
      'state failed',
      'role explorer',
      'role reviewer',
      'role builder',
      'role tester',
      'role planner',
      'role researcher',
    ])
    await clock.advance(60_000)
    expect(await paneTexts($)).not.toContain('Preview minimal')
  })

  test('an invalid selected pack shows a warning and the fallback; an edit shows within one check, with no restart', async ($, on) => {
    const clock = mock.clock(on, { now: 0 })
    engine(on)
    const files = { [`${DIR}/mine/pack.json`]: { text: packText('mine'), mtimeMs: 1 } }
    fakeFs(on, files)
    await packCommand($, 'mine')
    await $.command.run({ command: 'crabarium', args: '' } as never)
    files[`${DIR}/mine/pack.json`] = { text: '{', mtimeMs: 2 }
    await clock.advance(3000)
    expect(await paneTexts($)).toContain('pack "mine" is not valid: run /crabarium pack check mine; the pane shows minimal')
    files[`${DIR}/mine/pack.json`] = { text: packText('mine'), mtimeMs: 3 }
    await clock.advance(3000)
    expect((await paneTexts($)).some(t => t.includes('is not valid'))).toBe(false)
  })

  test('no command writes a file', async ($, on) => {
    mock.clock(on, { now: 0 })
    engine(on)
    const log = fakeFs(on, { [`${DIR}/mine/pack.json`]: { text: packText('mine'), mtimeMs: 1 } })
    // The commands run in order: each one reads what the one before it wrote.
    // oxlint-disable-next-line no-await-in-loop -- the order is the test.
    for (const args of ['', 'reload', 'check mine', 'mine', 'preview mine', 'preview']) await packCommand($, args)
    expect(log.writes).toEqual([])
  })
})

// The engine beneath starts each spawn with the first word of its description as the id.
function spawns(on: On): void {
  on('agent.spawn', async (_$, e) => ({ model: 'claude-haiku-5-5', agentId: e.description.split(' ')[0]! }))
}

// Two agents whose words give different roles, and one with no role. Spawn
// order is row order, so the spawns run one after another.
async function cellsByAgent($: Engine): Promise<string[]> {
  for (const description of ['review the loop', 'test the loop', 'ponder the loop']) {
    // oxlint-disable-next-line no-await-in-loop -- the order is the row order.
    await $.agent.spawn({ prompt: 'p', description, subagentType: 'general-purpose' } as never)
  }
  const pane = await $.ui.mount({
    plugin: 'crabarium',
    surface: 'terminal',
    component: 'Pane',
    requestId: PANE_ID,
    props: { title: 'crabarium', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  })
  const rasters = await pane.findAll({ type: 'Raster' })
  await pane.unmount()
  return rasters.map(r => String((r.props as { cells?: unknown }).cells))
}

describe('outfits in the pane', () => {
  test('each agent wears the outfit of its role, and an agent with no role the pack default', async ($, on) => {
    mock.clock(on, { now: 0 })
    engine(on)
    fakeFs(on, {})
    spawns(on)
    const [review, test_, ponder] = await cellsByAgent($)
    expect(new Set([review, test_, ponder]).size).toBe(3)
  })

  test('avatarMode off in /config gives every agent the pack default', async ($, on) => {
    mock.clock(on, { now: 0 })
    engine(on)
    fakeFs(on, {})
    spawns(on)
    await $.config.set({
      key: 'crabarium.avatarMode',
      value: 'off',
      previous: 'keywords',
      provider: { plugin: 'crabarium', tier: 'user' },
      origin: { kind: 'composer' },
    } as never)
    const cells = await cellsByAgent($)
    expect(new Set(cells).size).toBe(1)
  })
})

describe('review cases', () => {
  test('a preview keeps animating while an agent runs, though the agent is hidden', async ($, on) => {
    const clock = mock.clock(on, { now: 0 })
    engine(on)
    fakeFs(on, {})
    spawns(on)
    const blits: string[] = []
    on('ui.blit', async (_$, e) => {
      blits.push((e as { key: string }).key)
      return { value: {} } as never
    })
    await $.agent.spawn({ prompt: 'p', description: 'review the loop', subagentType: 'general-purpose' } as never)
    await packCommand($, 'preview minimal')
    await paneTexts($)
    blits.length = 0
    await clock.advance(1000)
    // The working figure walks at 6 fps; nothing blits the hidden agent.
    expect(blits.filter(k => k === 'avatar-preview:state:working').length).toBeGreaterThan(3)
    expect(blits.filter(k => k === 'avatar-review')).toEqual([])
  })

  test('the pack check stops when the pane closes', async ($, on) => {
    const clock = mock.clock(on, { now: 0 })
    engine(on)
    const log = fakeFs(on, { [`${DIR}/mine/pack.json`]: { text: packText('mine'), mtimeMs: 1 } })
    on('ui.close', async () => ({ value: undefined }) as never)
    // The first /crabarium opens the pane, the second closes it.
    await $.command.run({ command: 'crabarium', args: '' } as never)
    await $.command.run({ command: 'crabarium', args: '' } as never)
    const reads = log.reads.length
    await clock.advance(10_000)
    expect(log.reads).toHaveLength(reads)
  })

  test('a user pack with a subcommand name is not valid, and a preview of an unknown or invalid pack does not start', async ($, on) => {
    mock.clock(on, { now: 0 })
    const log = engine(on)
    fakeFs(on, {
      [`${DIR}/reload/pack.json`]: { text: packText('reload'), mtimeMs: 1 },
      [`${DIR}/bad/pack.json`]: { text: '{', mtimeMs: 1 },
    })
    expect(await packCommand($, 'check reload')).toBe(
      'reload (user) is not valid:\n  (directory): "reload" is a word of /crabarium pack; rename the directory',
    )
    expect(await packCommand($, 'preview minmal')).toBe('No pack "minmal".')
    expect(await packCommand($, 'preview bad')).toBe('bad is not valid: /crabarium pack check bad')
    expect(log.opened).toBe(0)
  })

  test('a read error is read again on the next check, though the file time did not change', async ($, on) => {
    mock.clock(on, { now: 0 })
    engine(on)
    const file = `${DIR}/mine/pack.json`
    const files: Record<string, FakeFile> = { [file]: { text: packText('mine'), mtimeMs: 1, deny: 'EACCES' } }
    const log = fakeFs(on, files)
    expect(await packCommand($, 'check mine')).toContain('EACCES')
    files[file] = { text: packText('mine'), mtimeMs: 1 }
    expect(await packCommand($, 'check mine')).toMatch(/^mine \(user\) is valid/)
    expect(log.reads.length).toBeGreaterThan(0)
  })
})

test('two scans differ when a file goes from a read error to its text, at the same time and size', () => {
  const at = { mtimeMs: 1, size: 9 }
  expect(samePackFiles({ dir: DIR, packs: { a: { ...at, error: 'EACCES' } } }, { dir: DIR, packs: { a: { ...at, text: '{}' } } })).toBe(
    false,
  )
  expect(samePackFiles({ dir: DIR, packs: { a: { ...at, text: '{}' } } }, { dir: DIR, packs: { a: { ...at, text: '{}' } } })).toBe(true)
})

test('an empty CLAUDE_CONFIG_DIR counts as unset: the packs are in the home directory', async ($, on) => {
  mock.clock(on, { now: 0 })
  mock.env(on, { CLAUDE_CONFIG_DIR: '', HOME })
  on('config.list', async () => ({ value: [] }) as never)
  fakeFs(on, {})
  expect(await packCommand($, '')).toContain(`User packs: ${DIR}/<name>/pack.json`)
})
