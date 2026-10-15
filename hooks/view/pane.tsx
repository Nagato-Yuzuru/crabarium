// View: draws the pane from the state. It reads; it never writes.
import { atom, read } from 'claude-code'
import type { On, ThemeKey } from 'claude-code'

import { durationMs, initialAgents, isEnded } from '../core/agents'
import type { AgentBoard, AgentRow, AgentStatus } from '../core/agents'
import type { MotionMode } from '../core/character'
import { initialSession } from '../core/session'
import type { MainSession } from '../core/session'
import { PANE_ID } from '../state'
import { avatarKey, framePlan, framesDrawn, stopFrames } from './frames'

const session = atom({ plugin: 'crabarium', key: 'session' } as const, initialSession)
const agents = atom({ plugin: 'crabarium', key: 'agents' } as const, initialAgents)

const UNKNOWN = '—'

export function sessionRows(s: MainSession): ReadonlyArray<readonly [label: string, value: string]> {
  return [
    ['model', s.model ?? UNKNOWN],
    ['context', s.contextPercent === null ? UNKNOWN : `${Math.round(s.contextPercent)}%`],
    ['cost', s.costUsd === null ? UNKNOWN : `$${s.costUsd.toFixed(2)}`],
  ]
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return UNKNOWN
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${pad(s % 60)}s`
  return `${Math.floor(s / 3600)}h ${pad(Math.floor(s / 60) % 60)}m`
}

const STATUS_COLOR: Readonly<Record<AgentStatus, ThemeKey>> = {
  pending: 'inactive',
  running: 'claude',
  waiting: 'warning',
  idle: 'inactive',
  completed: 'success',
  failed: 'error',
  killed: 'warning',
}

export type AgentLine = {
  id: string
  description: string
  detail: string
  status: AgentStatus
  duration: string
}

export type AgentGroup = { title: 'Running' | 'Finished'; lines: readonly AgentLine[] }

/** The agents split into live and ended groups, in spawn order. An empty group is left out. */
export function agentGroups(board: AgentBoard): readonly AgentGroup[] {
  const line = (row: AgentRow): AgentLine => ({
    id: row.id,
    description: row.description,
    detail: `${row.type} · ${row.model}`,
    status: row.status,
    duration: formatDuration(durationMs(row, board.now)),
  })
  const groups: AgentGroup[] = [
    { title: 'Running', lines: board.rows.filter(r => !isEnded(r.status)).map(line) },
    { title: 'Finished', lines: board.rows.filter(r => isEnded(r.status)).map(line) },
  ]
  return groups.filter(g => g.lines.length > 0)
}

export function registerPane(on: On, mode: MotionMode): void {
  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    // The terminal draws the character with half blocks; other surfaces get it with the Svg renderer.
    const raster = e.surface === 'terminal' ? $.ui.resolve(e).Raster : undefined
    const rows = sessionRows(await read($, session))
    const board = await read($, agents)
    const groups = agentGroups(board)
    const labelWidth = Math.max(...rows.map(([label]) => label.length)) + 2
    // The current frame, so that a redraw continues the motion and does not start it again.
    const now = raster === undefined ? null : await $.clock.now()
    const plan = now === null ? null : framePlan(board, now, mode)
    if (plan !== null && now !== null) framesDrawn($, mode, plan, now)

    return (
      <Box flexDirection="column">
        <Text weight="semibold">Main session</Text>
        {rows.map(([label, value]) => (
          <Box key={label}>
            <Box width={labelWidth}>
              <Text dimColor>{label}</Text>
            </Box>
            <Text>{value}</Text>
          </Box>
        ))}
        {groups.map(group => (
          <Box key={group.title} flexDirection="column" marginTop={1}>
            <Text weight="semibold">{`${group.title} (${group.lines.length})`}</Text>
            {group.lines.map(l => (
              <Box key={l.id} marginTop={raster === undefined ? 0 : 1} alignItems="center">
                {/* A Raster paints all its columns even where the layout gives it fewer. So its column
                    has a fixed width and does not shrink; the text column gives way instead. */}
                {raster !== undefined && plan !== null && (
                  <Box width={plan.images.get(l.id)!.columns} flexShrink={0} marginRight={1}>
                    {h(raster, { key: avatarKey(l.id), ...plan.images.get(l.id)! })}
                  </Box>
                )}
                <Box flexDirection="column" flexGrow={1} flexShrink={1}>
                  <Box>
                    <Box flexGrow={1}>
                      <Text wrap="truncate-end">{l.description}</Text>
                    </Box>
                    <Text color={STATUS_COLOR[l.status]}>{` ${l.status} `}</Text>
                    <Text tabular>{l.duration}</Text>
                  </Box>
                  <Text dimColor wrap="truncate-end">{`  ${l.detail}`}</Text>
                </Box>
              </Box>
            ))}
          </Box>
        ))}
      </Box>
    )
  })

  // An observer: if it fails, the close goes on.
  on('ui.close', { id: PANE_ID }, (_$, e, next) => {
    stopFrames()
    return next(e)
  }).catch((_$, e, next) => next(e))
}
