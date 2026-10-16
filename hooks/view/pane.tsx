// View: draws the pane from the state. It reads; it never writes.
import { atom, read } from 'claude-code'
import type { Elements, On, ThemeKey } from 'claude-code'

import { initialAgents } from '../core/agents'
import type { AgentStatus } from '../core/agents'
import type { MotionMode } from '../core/character'
import { initialSession } from '../core/session'
import { initialUsage } from '../core/usage/usage'
import { PANE_ID } from '../state'
import { avatarKey, framePlan, framesDrawn, stopFrames } from './frames'
import { paneLayout } from './layout'
import type { AgentLine, Folded, Stat } from './layout'

const session = atom({ plugin: 'crabarium', key: 'session' } as const, initialSession)
const agents = atom({ plugin: 'crabarium', key: 'agents' } as const, initialAgents)
const usage = atom({ plugin: 'crabarium', key: 'usage' } as const, initialUsage)

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

/** Three cards and the two one-column gaps between them fill the body. */
function cardWidth(columns: number): number {
  return Math.floor((columns - 2) / 3)
}

function statsLine(stats: readonly Stat[]): string {
  return stats.map(s => `${s.label} ${s.value ?? '—'}${s.note === undefined ? '' : ` (${s.note})`}`).join(' · ')
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
    const [s, board, u, now] = await Promise.all([read($, session), read($, agents), read($, usage), $.clock.now()])
    const layout = paneLayout(board, s, u, now, columns, raster !== undefined)
    // The current frames, so that a redraw continues each motion and does not start it again.
    const plan = raster === undefined ? null : framePlan(board, layout.characters, now, mode)
    if (plan !== null) framesDrawn($, mode, layout.characters, plan, now)

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

    const { header, steps } = layout
    return (
      <Box flexDirection="column">
        <Box>
          <Text weight="semibold">Main session</Text>
          <Text dimColor wrap="truncate-end">{`  ${header.model} · context ${header.context}`}</Text>
        </Box>
        {steps.cards ? (
          <Box gap={1}>
            {header.stats.map(stat => (
              <Box key={stat.label} borderStyle="round" borderDimColor flexDirection="column" width={cardWidth(columns)} paddingX={1}>
                <Text dimColor wrap="truncate-end">
                  {stat.note === undefined ? stat.label : `${stat.label} · ${stat.note}`}
                </Text>
                {stat.value === null ? <Text dimColor>—</Text> : <Text weight="semibold">{stat.value}</Text>}
              </Box>
            ))}
          </Box>
        ) : (
          <Text wrap="truncate-end">{statsLine(header.stats)}</Text>
        )}
        {layout.groups.map(group => {
          const count = ` ${group.agents} `
          return (
            <Box key={group.title} flexDirection="column" marginTop={1}>
              <Box>
                <Text weight="semibold">{group.title}</Text>
                <Text dimColor>{count}</Text>
                <Text dimColor wrap="truncate">
                  {'─'.repeat(Math.max(0, columns - group.title.length - count.length))}
                </Text>
              </Box>
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
        {layout.earlier > 0 && <Text dimColor>{`+ ${layout.earlier} earlier`}</Text>}
      </Box>
    )
  })

  // An observer: if it fails, the close goes on.
  on('ui.close', { id: PANE_ID }, (_$, e, next) => {
    stopFrames()
    return next(e)
  }).catch((_$, e, next) => next(e))
}
