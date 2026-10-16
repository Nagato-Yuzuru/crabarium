import type { On } from 'claude-code'
import type { Engine, MockClock } from 'claude-code/testing'
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
    mock.clock(on, { now: 0 })
    answerSteps(on)

    await step($, { model: 'claude-opus-5-5' })
    await step($, { model: 'claude-haiku-5-5', agentId: 'a1' })

    const pane = await $.ui.mount({ plugin: 'crabarium', surface, component: 'Pane', requestId: PANE_ID, props: paneProps })

    // The header shows the short model name.
    expect(await pane.findAll({ type: 'Text', text: 'opus-5-5 · context' })).toHaveLength(1)
    expect(await pane.findAll({ type: 'Text', text: 'haiku-5-5' })).toHaveLength(0)
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

    // `text` matches by inclusion, so exact matches are anchored.
    expect(await pane.findAll({ type: 'Text', text: /^Running$/ })).toHaveLength(1)
    expect(await pane.findAll({ type: 'Text', text: 'write the tests' })).toHaveLength(1)
    expect(await pane.findAll({ type: 'Text', text: /^Finished$/ })).toHaveLength(1)
    expect(await pane.findAll({ type: 'Text', text: /^ 1 $/ })).toHaveLength(2)
    expect(await pane.findAll({ type: 'Text', text: 'read the docs' })).toHaveLength(1)
    // The finished agent ran 5 s; the live one has run 3 s now. Without a character, line 2 is indented.
    const indent = surface === 'terminal' ? '' : '  '
    expect(await pane.findAll({ type: 'Text', text: `${indent}5s · Explore · haiku-5-5` })).toHaveLength(1)
    expect(await pane.findAll({ type: 'Text', text: `${indent}3s · general-purpose · haiku-5-5` })).toHaveLength(1)
    expect(await pane.findAll({ type: 'Text', text: 'refused task' })).toHaveLength(0)
    // One character for each row on the terminal; the Svg renderer brings it to the other surfaces.
    expect(await pane.findAll({ type: 'Raster' })).toHaveLength(surface === 'terminal' ? 2 : 0)
  })
}

// The surface beneath the plugin: it takes each blit and records the time.
// `deny` makes it refuse them; `latencyMs` makes it answer late.
function blitSurface(on: On, clock: MockClock, latencyMs = 0): { times: number[]; deny: boolean } {
  const log = { times: [] as number[], deny: false }
  on('ui.blit', async () => {
    if (latencyMs > 0) await clock.sleep(latencyMs)
    log.times.push(clock.now())
    return { value: log.deny ? { deny: 'not mounted' } : {} }
  })
  return log
}

// Counts the waits that the plugin asks for, and refuses the next one when told to.
function waits(on: On): { count: number; refuseNext: boolean } {
  const log = { count: 0, refuseNext: false }
  // A matcher that takes every wait: the kit allows one unmatched hook for an event, and mock.clock has it.
  on('clock.after', { ms: /^/ }, (_$, e, next) => {
    log.count += 1
    if (!log.refuseNext) return next(e)
    log.refuseNext = false
    return { deny: 'refused' } as never
  })
  return log
}

async function openWithOneAgent($: Engine): Promise<void> {
  await $.agent.spawn({ prompt: 'p', description: 'read the docs', subagentType: 'Explore' } as never)
  await $.ui.mount({ plugin: 'crabarium', surface: 'terminal', component: 'Pane', requestId: PANE_ID, props: paneProps })
}

test('a working character is repainted at each frame change of its walk, and not after it stands still', async ($, on) => {
  const after = waits(on)
  const clock = mock.clock(on, { now: 0 })
  answerAgents(on)
  const blits = blitSurface(on, clock)

  await openWithOneAgent($)
  await clock.advance(1_000)
  // The walk has 2 frames at 6 fps, from the spawn at 0.
  expect(blits.times).toEqual([167, 334, 500, 667, 834, 1000])

  await $.turn.complete({ turnId: 't1', agentId: 'a1', reason: 'answer', answer: '' } as never)
  await clock.advance(1_000)
  blits.times.length = 0
  const before = after.count
  await clock.advance(5_000)
  expect(blits.times).toEqual([])
  expect(after.count).toBe(before)
})

for (const motion of ['reduced', 'off'] as const) {
  test(`motion ${motion}: a working character starts no frame loop`, { options: { motion } }, async ($, on) => {
    const after = waits(on)
    const clock = mock.clock(on, { now: 0 })
    answerAgents(on)
    const blits = blitSurface(on, clock)

    await openWithOneAgent($)
    await clock.advance(5_000)
    expect([blits.times, after.count]).toEqual([[], 0])
  })
}

test('the pane starts no frame loop on a surface without Rasters', async ($, on) => {
  const after = waits(on)
  const clock = mock.clock(on, { now: 0 })
  answerAgents(on)
  const blits = blitSurface(on, clock)

  await $.agent.spawn({ prompt: 'p', description: 'read the docs', subagentType: 'Explore' } as never)
  await $.ui.mount({ plugin: 'crabarium', surface: 'desktop', component: 'Pane', requestId: PANE_ID, props: paneProps })
  await clock.advance(5_000)
  expect([blits.times, after.count]).toEqual([[], 0])
})

test('a close while a blit is still on its way stops the loop', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  answerAgents(on)
  let open = true
  on(
    'ui.panes',
    async () => ({ value: open ? [{ id: PANE_ID, title: 'crabarium', isShown: true, isFocused: false, isPlaced: true }] : [] }) as never,
  )
  on('ui.close', async () => {
    open = false
    return { value: undefined } as never
  })
  const blits = blitSurface(on, clock, 20)

  await openWithOneAgent($)
  // The tick at 167 ms waits for its blit until 187 ms; the close comes first.
  await clock.advance(170)
  await $.command.run({ command: 'crabarium', args: '' } as never)
  blits.times.length = 0
  await clock.advance(5_000)
  expect(blits.times).toEqual([187])
})

test('a denied blit stops the loop, and the next render starts it again', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  answerAgents(on)
  const blits = blitSurface(on, clock)

  await openWithOneAgent($)
  blits.deny = true
  await clock.advance(1_000)
  expect(blits.times).toEqual([167])

  blits.deny = false
  await $.agent.spawn({ prompt: 'p', description: 'write the tests', subagentType: 'Explore' } as never)
  blits.times.length = 0
  await clock.advance(500)
  expect(blits.times.length).toBeGreaterThan(0)
})

test('a refused wait stops the loop, and the next render starts it again', async ($, on) => {
  const after = waits(on)
  const clock = mock.clock(on, { now: 0 })
  answerAgents(on)
  const blits = blitSurface(on, clock)

  after.refuseNext = true
  await openWithOneAgent($)
  await clock.advance(1_000)
  expect(blits.times).toEqual([])

  await $.agent.spawn({ prompt: 'p', description: 'write the tests', subagentType: 'Explore' } as never)
  await clock.advance(500)
  expect(blits.times.length).toBeGreaterThan(0)
})

test('the frame loop stops when the pane narrows below the character step', async ($, on) => {
  const after = waits(on)
  const clock = mock.clock(on, { now: 0 })
  answerAgents(on)
  const blits = blitSurface(on, clock)

  await $.agent.spawn({ prompt: 'p', description: 'read the docs', subagentType: 'Explore' } as never)
  const wide = await $.ui.mount({ plugin: 'crabarium', surface: 'terminal', component: 'Pane', requestId: PANE_ID, props: paneProps })
  await clock.advance(500)
  expect(blits.times.length).toBeGreaterThan(0)

  // The surface draws the pane again at the new width.
  await wide.unmount()
  await $.ui.mount({
    plugin: 'crabarium',
    surface: 'terminal',
    component: 'Pane',
    requestId: PANE_ID,
    props: { ...paneProps, bodyColumns: 47 },
  })
  blits.times.length = 0
  const before = after.count
  await clock.advance(5_000)
  expect([blits.times, after.count]).toEqual([[], before])
})

// A main-loop agent with one live subagent, in a pane `columns` wide.
async function treeAt($: Engine, on: On, columns: number) {
  mock.clock(on, { now: 0 })
  answerAgents(on)
  await $.agent.spawn({ prompt: 'p', description: 'review the loop', subagentType: 'Explore' } as never)
  await $.agent.spawn({ prompt: 'p', description: 'run the tests', subagentType: 'Explore', parentAgentId: 'a1' } as never)
  return $.ui.mount({
    plugin: 'crabarium',
    surface: 'terminal',
    component: 'Pane',
    requestId: PANE_ID,
    props: { ...paneProps, bodyColumns: columns },
  })
}

// Each step starts at the exact column count in STEP; the layout tests cover the boundaries.
for (const [columns, cards, rasters] of [
  [80, true, 2],
  [63, false, 2],
  [55, false, 1],
  [47, false, 0],
] as const) {
  test(`a ${columns}-column pane draws ${cards ? 'stat cards' : 'one stats line'} and ${rasters} characters`, async ($, on) => {
    const pane = await treeAt($, on, columns)
    expect(await pane.findAll({ type: 'Text', text: /^cost$/ })).toHaveLength(cards ? 1 : 0)
    expect(await pane.findAll({ type: 'Text', text: 'cost — · tokens — · time —' })).toHaveLength(cards ? 0 : 1)
    expect(await pane.findAll({ type: 'Raster' })).toHaveLength(rasters)
    // The subagent hangs under its parent in every step.
    expect(await pane.findAll({ type: 'Text', text: 'run the tests' })).toHaveLength(1)
    expect(await pane.findAll({ type: 'Text', text: /^└ $/ })).toHaveLength(1)
  })
}

test('a subagent of a subagent folds into a count on its parent row', async ($, on) => {
  mock.clock(on, { now: 0 })
  answerAgents(on)
  await $.agent.spawn({ prompt: 'p', description: 'review the loop', subagentType: 'Explore' } as never)
  await $.agent.spawn({ prompt: 'p', description: 'run the tests', subagentType: 'Explore', parentAgentId: 'a1' } as never)
  await $.agent.spawn({ prompt: 'p', description: 'grep the branch', subagentType: 'Explore', parentAgentId: 'a2' } as never)
  const pane = await $.ui.mount({ plugin: 'crabarium', surface: 'terminal', component: 'Pane', requestId: PANE_ID, props: paneProps })
  expect(await pane.findAll({ type: 'Text', text: 'grep the branch' })).toHaveLength(0)
  expect(await pane.findAll({ type: 'Text', text: '0s · +1 nested, 1 running · Explore · haiku-5-5' })).toHaveLength(1)
})

for (const [columns, figures] of [
  [80, true],
  [79, false],
] as const) {
  test(`a subagent's step usage shows as its figures at ${columns} columns: ${figures ? 'shown' : 'left out'}`, async ($, on) => {
    mock.clock(on, { now: 0 })
    answerAgents(on)
    // The model beneath answers each step with fixed usage.
    // oxlint-disable-next-line require-yield -- turn.step hooks are generators; this one answers with its return value alone.
    on('turn.step', async function* (_$, e) {
      const usage = {
        model: 'claude-haiku-5-5',
        input_tokens: 2000,
        output_tokens: 500,
        cache_read_input_tokens: 40_000,
        cache_creation_input_tokens: 0,
      }
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage } as never
    })

    await $.agent.spawn({ prompt: 'p', description: 'read the docs', subagentType: 'Explore' } as never)
    await step($, { model: 'claude-haiku-5-5', agentId: 'a1' })
    const pane = await $.ui.mount({
      plugin: 'crabarium',
      surface: 'terminal',
      component: 'Pane',
      requestId: PANE_ID,
      props: { ...paneProps, bodyColumns: columns },
    })

    // 2.5k new tokens (the 40k cache reads are left out); the prompt is 42k of a 1M window: 4%. No agent shows a cost.
    expect(await pane.findAll({ type: 'Text', text: '2.5k tok · ctx 4%' })).toHaveLength(figures ? 1 : 0)
    expect(await pane.findAll({ type: 'Text', text: '≈$' })).toHaveLength(0)
    // The tokens card counts the step at every width.
    expect(await pane.findAll({ type: 'Text', text: /^2\.5k$|tokens 2\.5k \(95% hit\)/ })).toHaveLength(1)
    expect(await pane.findAll({ type: 'Text', text: /tokens · 95% hit|\(95% hit\)/ })).toHaveLength(1)
  })
}

// A model beneath that answers each step with `usage`, and counts the steps it answered.
function answerStepsWith(on: On, usage: unknown): { steps: number } {
  const log = { steps: 0 }
  // oxlint-disable-next-line require-yield -- turn.step hooks are generators; this one answers with its return value alone.
  on('turn.step', async function* (_$, e) {
    log.steps += 1
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage } as never
  })
  return log
}

const SOME_USAGE = {
  model: 'claude-opus-5-5',
  input_tokens: 1000,
  output_tokens: 0,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
}

// The three card values as the pane shows them now.
async function cardValues($: Engine): Promise<string[]> {
  const pane = await $.ui.mount({
    plugin: 'crabarium',
    surface: 'terminal',
    component: 'Pane',
    requestId: PANE_ID,
    props: { ...paneProps, bodyColumns: 80 },
  })
  const values = (await pane.findAll({ type: 'Text', text: /^(1k|2k|—)$/ })).map(t => t.text)
  await pane.unmount()
  return values
}

function logLines(on: On): string[] {
  const lines: string[] = []
  on('ui.log', async (_$, e) => {
    lines.push(String((e as { text?: unknown }).text ?? e))
    return { value: undefined } as never
  })
  return lines
}

test('a step that got no response counts nothing', async ($, on) => {
  mock.clock(on, { now: 0 })
  answerStepsWith(on, null)
  const logs = logLines(on)
  await step($, { model: 'claude-opus-5-5' })
  // The tokens card shows unknown (the cost and the time cards are unknown too in a test), and nothing failed.
  expect(await cardValues($)).toEqual(['—', '—', '—'])
  expect(logs).toEqual([])
})

test('a refused write of the usage only logs: the step still answers', async ($, on) => {
  mock.clock(on, { now: 0 })
  const model = answerStepsWith(on, SOME_USAGE)
  on('state.set', { key: 'usage' }, async () => ({ deny: 'read-only in this test' }) as never)
  const logs = logLines(on)

  await step($, { model: 'claude-opus-5-5' })
  expect(model.steps).toBe(1)
  expect(logs.some(l => l.includes('the usage of a step was not recorded'))).toBe(true)
})

test('a /clear starts the token sums again', async ($, on) => {
  mock.clock(on, { now: 0 })
  answerStepsWith(on, SOME_USAGE)
  on('session.end', async (_$, e) => ({ sessionId: e.sessionId }))
  await step($, { model: 'claude-opus-5-5' })
  await step($, { model: 'claude-opus-5-5' })
  expect(await cardValues($)).toEqual(['—', '2k', '—'])

  await $.session.end({ reason: 'clear', sessionId: 's1', resume: {} } as never)
  expect(await cardValues($)).toEqual(['—', '—', '—'])
})
