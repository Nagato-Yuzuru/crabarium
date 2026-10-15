import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { PANE_ID } from '../hooks/state'

const paneProps = {
  title: 'crabarium',
  isFocused: false,
  bodyColumns: 60,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 20 },
  view: {},
} as const

// The model request beneath the plugin: an empty answer is enough here.
function answerSteps(on: On): void {
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null } as never
  })
}

// `$.turn.step` is a stream; the hooks run as it is read.
async function step($: Engine, fields: { model: string; agentId?: string }): Promise<void> {
  for await (const _chunk of $.turn.step({ turnId: 't1', index: 0, messageCount: 1, ...fields } as never)) {
    // Chunks do not matter here.
  }
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`the pane shows the model of the last main-session step, not a subagent's (${surface})`, async ($, on) => {
    answerSteps(on)

    await step($, { model: 'claude-opus-5-5' })
    await step($, { model: 'claude-haiku-5-5', agentId: 'a1' })

    const pane = await $.ui.mount({ plugin: 'crabarium', surface, component: 'Pane', requestId: PANE_ID, props: paneProps })

    expect(await pane.findAll({ type: 'Text', text: 'claude-opus-5-5' })).toHaveLength(1)
    expect(await pane.findAll({ type: 'Text', text: 'claude-haiku-5-5' })).toHaveLength(0)
  })
}
