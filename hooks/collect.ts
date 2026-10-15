// Event collection: the only layer that hooks engine events. It turns each
// event into a domain event and applies it to the state through the core.

import type { AgentInfo, EngineInterface, On, SessionUsage, Timer } from 'claude-code'
import { atom, update } from 'claude-code'

import type { AgentEvent } from './core/agents'
import { initialAgents, reduceAgents } from './core/agents'
import type { SessionEvent } from './core/session'
import { initialSession, reduceSession } from './core/session'
import { isSupportedEngine, MIN_ENGINE_VERSION } from './core/version'
import { PANE_ID } from './state'

const session = atom({ plugin: 'crabarium', key: 'session' } as const, initialSession)
const agents = atom({ plugin: 'crabarium', key: 'agents' } as const, initialAgents)

const POLL_MS = 1000

// A hot reload drops this module and its timers; session.start runs again
// then and restarts the poll for a pane that is still open.
let poll: Timer | null = null

export function usageEvent(usage: SessionUsage): SessionEvent {
  return {
    kind: 'usage-read',
    contextPercent: usage.context.percent ?? null,
    costUsd: usage.cost?.usd ?? null,
  }
}

export function listedEvent(list: readonly AgentInfo[], at: number): AgentEvent {
  return { kind: 'agents-listed', statuses: list.map(({ id, status }) => ({ id, status })), at }
}

async function dispatch($: EngineInterface, event: SessionEvent): Promise<void> {
  await update($, session, s => reduceSession(s, event))
}

async function dispatchAgent($: EngineInterface, event: AgentEvent): Promise<void> {
  await update($, agents, s => reduceAgents(s, event))
}

// One read of everything the pane polls: the usage, the agent list, the time.
async function refresh($: EngineInterface): Promise<void> {
  const [usage, list, at] = await Promise.all([$.session.usage(), $.agent.list(), $.clock.now()])
  await dispatch($, usageEvent(usage))
  await dispatchAgent($, listedEvent(list, at))
}

function startPoll($: EngineInterface): void {
  poll ??= $.clock.every(POLL_MS, () => void refresh($))
}

function stopPoll(): void {
  poll?.cancel()
  poll = null
}

async function isPaneOpen($: EngineInterface): Promise<boolean> {
  return (await $.ui.panes()).some(pane => pane.id === PANE_ID)
}

export function registerCollect(on: On): void {
  on('session.start', async ($, e, next) => {
    const { version } = await $.session.version()
    if (!isSupportedEngine(version)) {
      $.ui.log(`crabarium needs Claude Code ${MIN_ENGINE_VERSION} or later (this is ${version}); it stays off.`)
      return next(e)
    }
    await $.command.register({ name: 'crabarium', description: 'Show or hide the crabarium pane' })
    if (await isPaneOpen($)) {
      await refresh($)
      startPoll($)
    }
    return next(e)
  })

  on('command.run', { command: 'crabarium' }, async $ => {
    if (await isPaneOpen($)) {
      await $.ui.close({ id: PANE_ID })
      return { text: 'crabarium pane closed.' }
    }
    await refresh($)
    const opened = await $.ui.open({ id: PANE_ID, title: 'crabarium' })
    startPoll($)
    return { text: opened.isPlaced ? 'crabarium pane opened.' : `crabarium pane waits: ${opened.reason}` }
  })

  // An observer: if it fails, the close goes on.
  on('ui.close', { id: PANE_ID }, (_$, e, next) => {
    stopPoll()
    return next(e)
  }).catch((_$, e, next) => next(e))

  on('turn.step', async function* ($, e, next) {
    // A step with an agentId belongs to a subagent, not the main session.
    if (e.agentId === undefined) await dispatch($, { kind: 'model-used', model: e.model })
    return yield* next(e)
  })

  // Observers: if one fails, the spawn or the turn end goes on; `next(e)` in
  // the fallback gives back what the first `next` call settled to.
  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)
    // A denied spawn starts nothing, and a remote workflow agent has no local loop.
    if (result.deny !== undefined || result.agentId === undefined) return result
    await dispatchAgent($, {
      kind: 'agent-spawned',
      id: result.agentId,
      description: e.description,
      type: e.subagentType,
      model: result.model,
      parentId: e.parentAgentId ?? null,
      isTeammate: e.isTeammate === true,
      at: await $.clock.now(),
    })
    return result
  }).catch((_$, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) {
      await dispatchAgent($, { kind: 'agent-turn-ended', id: e.agentId, reason: e.reason, at: await $.clock.now() })
    }
    return result
  }).catch((_$, e, next) => next(e))
}
