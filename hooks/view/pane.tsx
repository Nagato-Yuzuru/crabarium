// View: draws the pane from the state. It reads; it never writes.
import { atom, read } from 'claude-code'
import type { Elements, On, ThemeKey } from 'claude-code'

import { initialAgents } from '../core/agents.ts'
import type { AgentStatus } from '../core/agents.ts'
import { parseRules, selectOutfit } from '../core/avatar/select.ts'
import { initialSettings } from '../core/avatar/settings.ts'
import type { MotionMode } from '../core/character.ts'
import { activePack, packEntries } from '../core/pack/registry.ts'
import { initialSession } from '../core/session.ts'
import { initialUsage } from '../core/usage/usage.ts'
import { builtinPackTexts } from '../packs.generated.ts'
import { NO_PACK_FILES } from '../packs.ts'
import { PANE_ID, SESSION_SHAPE } from '../state.ts'
import { fallbackPack } from './avatar.ts'
import { avatarKey, framePlan, framesDrawn, stopFrames } from './frames.ts'
import type { DrawnCharacter } from './frames.ts'
import { paneLayout } from './layout.ts'
import type { AgentLine, Folded, Limit, Stat } from './layout.ts'
import { previewModel } from './preview.ts'

const session = atom({ plugin: 'crabarium', key: 'session' } as const, initialSession, { shape: SESSION_SHAPE })
const agents = atom({ plugin: 'crabarium', key: 'agents' } as const, initialAgents)
const usage = atom({ plugin: 'crabarium', key: 'usage' } as const, initialUsage)
const settings = atom({ plugin: 'crabarium', key: 'settings' } as const, initialSettings)
const packFiles = atom({ plugin: 'crabarium', key: 'packFiles' } as const, NO_PACK_FILES)
const preview = atom({ plugin: 'crabarium', key: 'preview' } as const, null)

/** The mark and the theme color of each status. Pending, idle and waiting are all quiet. */
const STATUS_MARK: Readonly<Record<AgentStatus, { mark: string; color: ThemeKey }>> = {
  pending: { mark: '○', color: 'inactive' },
  running: { mark: '●', color: 'claude' },
  waiting: { mark: '◐', color: 'inactive' },
  idle: { mark: '○', color: 'inactive' },
  completed: { mark: '✓', color: 'success' },
  failed: { mark: '✗', color: 'error' },
  killed: { mark: '⊘', color: 'warning' },
}

const FOLDED_STATUSES = ['completed', 'failed', 'killed'] as const satisfies readonly (keyof Folded & AgentStatus)[]

/** The cards and the one-column gaps between them fill the body. */
function cardWidth(columns: number, count: number): number {
  return Math.floor((columns - (count - 1)) / count)
}

// A narrow line cuts from the end, so the three values come first and the details after them.
function statsLine(stats: readonly Stat[]): string {
  return [...stats.map(s => `${s.label} ${s.value ?? '—'}`), ...stats.flatMap(s => (s.detail === undefined ? [] : [s.detail]))].join(' · ')
}

function limitsLine(limits: readonly Limit[]): string {
  return `limits ${limits.map(l => `${l.name} ${l.used}`).join(' · ')}`
}

/** The two elements that every surface has, which the row helpers draw with. */
type Ui = Pick<Elements['terminal'], 'Box' | 'Text'>

function status({ Text }: Ui, l: AgentLine) {
  const { mark, color } = STATUS_MARK[l.status]
  return <Text color={color}>{` ${mark} ${l.status}`}</Text>
}

// A tree guide two lines high: the connector, then the line that goes on down (or space).
function guide({ Box, Text }: Ui, first: string, rest: string) {
  return (
    <Box flexDirection="column" width={2} flexShrink={0}>
      <Text dimColor>{first}</Text>
      <Text dimColor>{rest}</Text>
    </Box>
  )
}

function folded({ Box, Text }: Ui, f: Folded) {
  return (
    <Box>
      <Text dimColor>└ </Text>
      {FOLDED_STATUSES.filter(st => f[st] > 0).map((st, i) => (
        <Text key={st} color={STATUS_MARK[st].color}>{`${i > 0 ? '  ' : ''}${STATUS_MARK[st].mark} ${f[st]}`}</Text>
      ))}
      <Text dimColor>{`  ${f.agents} ended ${f.agents === 1 ? 'subagent' : 'subagents'}`}</Text>
    </Box>
  )
}

export function registerPane(on: On, mode: MotionMode): void {
  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text } = ui
    // The terminal draws the characters with half blocks; other surfaces get them with the Svg renderer.
    const raster = e.surface === 'terminal' ? $.ui.resolve(e).Raster : undefined
    const columns = e.props.bodyColumns
    const [s, board, u, now, config, files, shownPreview] = await Promise.all([
      read($, session),
      read($, agents),
      read($, usage),
      $.clock.now(),
      read($, settings),
      read($, packFiles),
      read($, preview),
    ])
    const layout = paneLayout(board, s, u, now, columns, raster !== undefined)
    const entries = packEntries(builtinPackTexts, files)
    const active = activePack(entries, config.pack, fallbackPack())
    const choice = { mode: config.avatarMode, rules: parseRules(config.avatarRules).rules }
    const rows = new Map(board.rows.map(r => [r.id, r]))
    const agentCharacters = layout.characters.flatMap(({ id, size }): DrawnCharacter[] => {
      const row = rows.get(id)
      if (row === undefined) return []
      const { parts } = selectOutfit(active.pack, { id, type: row.type, description: row.description }, choice)
      return [{ id, size, row, pack: active.pack, parts }]
    })
    const shown = previewModel(entries, shownPreview, now, layout.steps.character ? 'full' : null)
    // A preview hides the agents, so their Rasters are not mounted: a blit to one would stop the loop.
    const characters = shown === null ? agentCharacters : shown.characters
    // The current frames, so that a redraw continues each motion and does not start it again.
    const plan = raster === undefined ? null : framePlan(characters, now, mode)
    if (plan !== null) framesDrawn($, mode, characters, plan, now)

    const character = (id: string) => {
      const image = plan?.images.get(id)
      if (raster === undefined || image === undefined) return null
      // A Raster paints all its columns even where the layout gives it fewer. So
      // its column has a fixed width and does not shrink; the text gives way.
      return (
        <Box width={image.columns} flexShrink={0} marginRight={1}>
          {h(raster, { key: avatarKey(id), ...image })}
        </Box>
      )
    }

    // Line 1: the description and the status. Line 2: the detail, indented when no character shows.
    const text = (l: AgentLine) => (
      <Box flexDirection="column" flexGrow={1} flexShrink={1}>
        <Box>
          <Box flexGrow={1} flexShrink={1}>
            <Text wrap="truncate-end">{l.description}</Text>
          </Box>
          {status(ui, l)}
        </Box>
        <Text dimColor wrap="truncate-end">
          {l.character === null ? `  ${l.detail}` : l.detail}
        </Text>
      </Box>
    )

    // A group heading: the title, a count, and a rule to the edge.
    const heading = (title: string, count: string) => (
      <Box>
        <Text weight="semibold">{title}</Text>
        <Text dimColor>{count}</Text>
        <Text dimColor wrap="truncate">
          {'─'.repeat(Math.max(0, columns - title.length - count.length))}
        </Text>
      </Box>
    )

    const { header, steps } = layout
    // The limits card shows only when there are limits; the cards share the width.
    const width = cardWidth(columns, header.stats.length + (header.limits.length > 0 ? 1 : 0))
    return (
      <Box flexDirection="column">
        <Box>
          <Text weight="semibold">Main session</Text>
          <Text dimColor wrap="truncate-end">{`  ${[header.model, `context ${header.context}`, ...header.live].join(' · ')}`}</Text>
        </Box>
        {steps.cards ? (
          <Box gap={1}>
            {header.stats.map(stat => (
              <Box key={stat.label} borderStyle="round" borderDimColor flexDirection="column" width={width} paddingX={1}>
                <Text dimColor wrap="truncate-end">
                  {stat.label}
                </Text>
                {stat.value === null ? (
                  <Text dimColor>—</Text>
                ) : (
                  <Text weight="semibold" wrap="truncate-end">
                    {stat.value}
                  </Text>
                )}
                <Text dimColor wrap="truncate-end">
                  {stat.detail ?? ''}
                </Text>
              </Box>
            ))}
            {header.limits.length > 0 && (
              // One line for each window, so a name never parts from its percent.
              <Box key="limits" borderStyle="round" borderDimColor flexDirection="column" width={width} paddingX={1}>
                <Text dimColor>limits</Text>
                {header.limits.map(l => (
                  <Text key={l.name} wrap="truncate-end">
                    <Text dimColor>{`${l.name} `}</Text>
                    <Text weight="semibold">{l.used}</Text>
                  </Text>
                ))}
              </Box>
            )}
          </Box>
        ) : (
          <Box flexDirection="column">
            <Text wrap="truncate-end">{statsLine(header.stats)}</Text>
            {header.limits.length > 0 && <Text wrap="truncate-end">{limitsLine(header.limits)}</Text>}
          </Box>
        )}
        {active.problem !== null && (
          <Text color="warning" wrap="truncate-end">
            {`${active.problem}; the pane shows ${active.name}`}
          </Text>
        )}
        {shown !== null ? (
          // A preview takes the place of the agents until it ends.
          <Box flexDirection="column" marginTop={1}>
            {heading(shown.title, ' ')}
            {shown.problem !== null && (
              <Text color="warning" wrap="truncate-end">
                {shown.problem}
              </Text>
            )}
            {shown.lines.map(l => (
              <Box key={l.id} alignItems="center">
                {character(l.id)}
                {text(l)}
              </Box>
            ))}
          </Box>
        ) : null}
        {(shown === null ? layout.groups : []).map(group => {
          return (
            <Box key={group.title} flexDirection="column" marginTop={1}>
              {heading(group.title, ` ${group.agents} `)}
              {group.trees.map((tree, i) => (
                <Box key={tree.root.id} flexDirection="column" marginTop={i > 0 && !steps.character ? 1 : 0}>
                  <Box alignItems="center">
                    {character(tree.root.id)}
                    {text(tree.root)}
                  </Box>
                  {tree.children.map((child, j) => {
                    const isLast = j === tree.children.length - 1 && tree.folded === null
                    return (
                      <Box key={child.id}>
                        {guide(ui, isLast ? '└ ' : '├ ', isLast ? '  ' : '│ ')}
                        {character(child.id)}
                        {text(child)}
                      </Box>
                    )
                  })}
                  {tree.folded !== null && folded(ui, tree.folded)}
                </Box>
              ))}
            </Box>
          )
        })}
        {shown === null && layout.earlier > 0 && <Text dimColor>{`+ ${layout.earlier} earlier`}</Text>}
      </Box>
    )
  })

  // An observer: if it fails, the close goes on.
  on('ui.close', { id: PANE_ID }, (_$, e, next) => {
    stopFrames()
    return next(e)
  }).catch((_$, e, next) => next(e))
}
