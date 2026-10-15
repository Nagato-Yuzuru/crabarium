// Event collection: the only layer that hooks engine events. It turns each
// event into a domain event and applies it to the state through the core.

import type { EngineInterface, On, SessionUsage, Timer } from 'claude-code'
import { atom, update } from 'claude-code'

import type { SessionEvent } from './core/session'
import { initialSession, reduceSession } from './core/session'
import { isSupportedEngine, MIN_ENGINE_VERSION } from './core/version'
import { PANE_ID } from './state'

const session = atom({ plugin: 'crabarium', key: 'session' } as const, initialSession)

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

async function dispatch($: EngineInterface, event: SessionEvent): Promise<void> {
  await update($, session, s => reduceSession(s, event))
}

async function readUsage($: EngineInterface): Promise<void> {
  await dispatch($, usageEvent(await $.session.usage()))
}

function startPoll($: EngineInterface): void {
  poll ??= $.clock.every(POLL_MS, () => void readUsage($))
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
      await readUsage($)
      startPoll($)
    }
    return next(e)
  })

  on('command.run', { command: 'crabarium' }, async $ => {
    if (await isPaneOpen($)) {
      await $.ui.close({ id: PANE_ID })
      return { text: 'crabarium pane closed.' }
    }
    await readUsage($)
    const opened = await $.ui.open({ id: PANE_ID, title: 'crabarium' })
    startPoll($)
    return { text: opened.isPlaced ? 'crabarium pane opened.' : `crabarium pane waits: ${opened.reason}` }
  })

  // An observer: if it fails, the close goes on.
  on('ui.close', (_$, e, next) => {
    if (e.id === PANE_ID) stopPoll()
    return next(e)
  }).catch((_$, e, next) => next(e))

  on('turn.step', async function* ($, e, next) {
    // A step with an agentId belongs to a subagent, not the main session.
    if (e.agentId === undefined) await dispatch($, { kind: 'model-used', model: e.model })
    return yield* next(e)
  })
}
