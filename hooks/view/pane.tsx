// View: draws the pane from the state. It reads; it never writes.

import type { On } from 'claude-code'
import { atom, read } from 'claude-code'

import type { MainSession } from '../core/session'
import { initialSession } from '../core/session'
import { PANE_ID } from '../state'

const session = atom({ plugin: 'crabarium', key: 'session' } as const, initialSession)

const UNKNOWN = '—'

export function sessionRows(s: MainSession): ReadonlyArray<readonly [label: string, value: string]> {
  return [
    ['model', s.model ?? UNKNOWN],
    ['context', s.contextPercent === null ? UNKNOWN : `${Math.round(s.contextPercent)}%`],
    ['cost', s.costUsd === null ? UNKNOWN : `$${s.costUsd.toFixed(2)}`],
  ]
}

export function registerPane(on: On): void {
  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const rows = sessionRows(await read($, session))
    const labelWidth = Math.max(...rows.map(([label]) => label.length)) + 2

    return (
      <Box flexDirection="column">
        <Text bold>Main session</Text>
        {rows.map(([label, value]) => (
          <Box>
            <Box width={labelWidth}>
              <Text dimColor>{label}</Text>
            </Box>
            <Text>{value}</Text>
          </Box>
        ))}
      </Box>
    )
  })
}
