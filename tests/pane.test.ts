import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

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
  // oxlint-disable-next-line require-yield -- turn.step hooks are generators; this one answers with its return value alone.
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

// The engine beneath the plugin: it starts each spawn as the next id, refuses
// one whose description says so, and lets each turn end.
function answerAgents(on: On): void {
  on('turn.complete', async () => ({ text: '' }))
  let next = 0
  on('agent.spawn', async (_$, e) => {
    if (e.description === 'refused task') return { deny: 'not allowed' }
    next += 1
    return { model: 'claude-haiku-5-5', agentId: `a${next}` }
  })
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`a spawned subagent shows under Running, then under Finished when its turn ends (${surface})`, async ($, on) => {
    const clock = mock.clock(on, { now: 10_000 })
    answerAgents(on)

    await $.agent.spawn({ prompt: 'p', description: 'read the docs', subagentType: 'Explore' } as never)
    await $.agent.spawn({ prompt: 'p', description: 'refused task', subagentType: 'Explore' } as never)
    await clock.advance(2_000)
    await $.agent.spawn({ prompt: 'p', description: 'write the tests', subagentType: 'general-purpose' } as never)
    await clock.advance(3_000)
    await $.turn.complete({ turnId: 't1', agentId: 'a1', reason: 'answer', answer: '' } as never)

    const pane = await $.ui.mount({ plugin: 'crabarium', surface, component: 'Pane', requestId: PANE_ID, props: paneProps })

    expect(await pane.findAll({ type: 'Text', text: 'Running (1)' })).toHaveLength(1)
    expect(await pane.findAll({ type: 'Text', text: 'write the tests' })).toHaveLength(1)
    expect(await pane.findAll({ type: 'Text', text: 'Finished (1)' })).toHaveLength(1)
    expect(await pane.findAll({ type: 'Text', text: 'read the docs' })).toHaveLength(1)
    // The finished agent ran 5 s; the live one has run 3 s at the last time read.
    expect(await pane.findAll({ type: 'Text', text: '5s' })).toHaveLength(1)
    expect(await pane.findAll({ type: 'Text', text: '3s' })).toHaveLength(1)
    expect(await pane.findAll({ type: 'Text', text: 'refused task' })).toHaveLength(0)
    // One character for each row on the terminal; the Svg renderer brings it to the other surfaces.
    expect(await pane.findAll({ type: 'Raster' })).toHaveLength(surface === 'terminal' ? 2 : 0)
  })
}
