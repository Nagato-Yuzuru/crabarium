// Event collection: the only layer that hooks engine events. It turns each
// event into a domain event and applies it to the state through the core.

import type {
  AgentInfo,
  EngineInterface,
  HookStream,
  On,
  SessionUsage,
  Timer,
  TurnStepChunk,
  TurnStepInput,
  TurnStepResult,
  TurnUsage,
} from 'claude-code'
import { atom, update } from 'claude-code'

import { refreshPacks, runPackCommand, settingChanged } from './commands'
import type { AgentEvent } from './core/agents'
import { initialAgents, reduceAgents } from './core/agents'
import type { AvatarSettings } from './core/avatar/settings'
import { initialSettings } from './core/avatar/settings'
import type { SessionEvent } from './core/session'
import { cacheTtlMs, initialSession, reduceSession } from './core/session'
import { initialUsage, reduceUsage } from './core/usage/usage'
import type { StepFinished, UsageEvent } from './core/usage/usage'
import { isSupportedEngine, MIN_ENGINE_VERSION } from './core/version'
import { PANE_ID, SESSION_SHAPE } from './state'

const session = atom({ plugin: 'crabarium', key: 'session' } as const, initialSession, { shape: SESSION_SHAPE })
const agents = atom({ plugin: 'crabarium', key: 'agents' } as const, initialAgents)
const usageBoard = atom({ plugin: 'crabarium', key: 'usage' } as const, initialUsage)
const settings = atom({ plugin: 'crabarium', key: 'settings' } as const, initialSettings)

const POLL_MS = 1000

// A hot reload drops this module and its timers; session.start runs again
// then and restarts the poll for a pane that is still open.
let poll: Timer | null = null

export function usageEvent(usage: SessionUsage, turns: number | null, at: number): SessionEvent {
  return {
    kind: 'usage-read',
    contextPercent: usage.context.percent ?? null,
    costUsd: usage.cost?.usd ?? null,
    startedAt: usage.startedAt,
    rateLimits: usage.rateLimits.map(({ kind, percentUsed }) => ({ kind, percentUsed })),
    turns,
    at,
  }
}

export function stepEvent(e: Pick<TurnStepInput, 'agentId' | 'effort'>, u: TurnUsage): StepFinished {
  return {
    kind: 'step-finished',
    agentId: e.agentId ?? null,
    model: u.model,
    effort: e.effort === undefined ? null : String(e.effort),
    tokens: {
      input: u.input_tokens,
      output: u.output_tokens,
      cacheRead: u.cache_read_input_tokens,
      cacheWrite: u.cache_creation_input_tokens,
    },
  }
}

export function listedEvent(list: readonly AgentInfo[], at: number): AgentEvent {
  return { kind: 'agents-listed', statuses: list.map(({ id, status }) => ({ id, status })), at }
}

async function dispatch($: EngineInterface, event: SessionEvent): Promise<void> {
  await update($, session, s => reduceSession(s, event))
}

async function dispatchUsage($: EngineInterface, event: UsageEvent): Promise<void> {
  await update($, usageBoard, s => reduceUsage(s, event))
}

// Runs a write of the mod's own state from a hook on engine work. A failure,
// in the write or in making its event, is logged and does not fail the work.
async function observe($: EngineInterface, what: string, write: () => Promise<void>): Promise<void> {
  await Promise.resolve()
    .then(write)
    .catch((error: unknown) => {
      $.ui.log(`crabarium: ${what} was not recorded: ${error instanceof Error ? error.message : String(error)}`)
    })
}

async function dispatchAgent($: EngineInterface, event: AgentEvent): Promise<void> {
  await update($, agents, s => reduceAgents(s, event))
}

/** The prompt origins that are the user's own: typed, through Remote Control, or from the SDK host. */
const USER_ORIGINS: ReadonlySet<string> = new Set(['composer', 'bridge', 'sdk'])

async function recordUsage($: EngineInterface, e: TurnStepInput, result: TurnStepResult): Promise<void> {
  // A step that got no response has no usage to count.
  if (result.usage === null) return
  const usage = result.usage
  await observe($, 'the usage of a step', () => dispatchUsage($, stepEvent(e, usage)))
}

// Passes a step's stream on unchanged. `done` gets the result and the time of
// the first content chunk (`null` when none came).
async function* timed(
  $: EngineInterface,
  stream: HookStream<TurnStepChunk, TurnStepResult>,
  done: (result: TurnStepResult, firstAt: number | null) => Promise<void>,
): AsyncGenerator<TurnStepChunk, TurnStepResult> {
  let firstAt: number | null = null
  for await (const chunk of stream) {
    if (firstAt === null && chunk.kind !== 'engine') firstAt = await $.clock.now().catch(() => null)
    yield chunk
  }
  const result = await stream.result
  await done(result, firstAt)
  return result
}

// One read of everything the pane polls: the usage, the agent list, the time.
async function refresh($: EngineInterface): Promise<void> {
  // The turn count is a detail: if the engine does not answer it, the rest still updates.
  const turns = $.session.turns().catch(() => null)
  const [usage, list, at] = await Promise.all([$.session.usage(), $.agent.list(), $.clock.now()])
  await dispatch($, usageEvent(usage, await turns, at))
  await dispatchAgent($, listedEvent(list, at))
}

// The API has no file watch, so the mod checks the user packs' file times
// while the pane is open. A failed check waits for the next one.
const PACK_POLL_MS = 3000
let packPoll: Timer | null = null

function startPoll($: EngineInterface): void {
  poll ??= $.clock.every(POLL_MS, () => void refresh($))
  packPoll ??= $.clock.every(PACK_POLL_MS, () => void refreshPacks($).catch(() => undefined))
}

function stopPoll(): void {
  poll?.cancel()
  poll = null
  packPoll?.cancel()
  packPoll = null
}

async function isPaneOpen($: EngineInterface): Promise<boolean> {
  return (await $.ui.panes()).some(pane => pane.id === PANE_ID)
}

async function openPane($: EngineInterface): Promise<string> {
  await refresh($)
  const opened = await $.ui.open({ id: PANE_ID, title: 'crabarium' })
  startPoll($)
  return opened.isPlaced ? 'crabarium pane opened.' : `crabarium pane waits: ${opened.reason}`
}

/** `options` are the plugin's `userConfig` values as the module loaded with them. */
export function registerCollect(on: On, options: AvatarSettings): void {
  on('session.start', async ($, e, next) => {
    const { version } = await $.session.version()
    if (!isSupportedEngine(version)) {
      $.ui.log(`crabarium needs Claude Code ${MIN_ENGINE_VERSION} or later (this is ${version}); it stays off.`)
      return next(e)
    }
    // The engine loads the module again with new options, so they are current here.
    await update($, settings, () => options)
    await $.command.register({
      name: 'crabarium',
      description: 'Show or hide the crabarium pane; `pack` lists, selects, checks and previews character packs',
      argumentHint: '[pack [<name> | reload | check [<name>] | preview [<name>]]]',
    })
    await refreshPacks($).catch(() => undefined)
    if (await isPaneOpen($)) {
      await refresh($)
      startPoll($)
    }
    return next(e)
  })

  on('command.run', { command: 'crabarium' }, async ($, e) => {
    const [word, ...rest] = e.args
      .trim()
      .split(/\s+/)
      .filter(w => w !== '')
    if (word === 'pack')
      return { text: await runPackCommand($, rest, { openPane: async () => void ((await isPaneOpen($)) || (await openPane($))) }) }
    if (word !== undefined) return { text: `Unknown argument ${JSON.stringify(word)}. Usage: /crabarium [pack ...]` }
    if (await isPaneOpen($)) {
      await $.ui.close({ id: PANE_ID })
      return { text: 'crabarium pane closed.' }
    }
    return { text: await openPane($) }
  })

  // The user changed a crabarium row in /config. An observer: if it fails, the change goes on.
  on('config.set', async ($, e, next) => {
    const result = await next(e)
    // The provider names the row's plugin; a caller that leaves it out names no plugin.
    if (result.deny === undefined && (e.provider as typeof e.provider | undefined)?.plugin === $.plugin.name) {
      await settingChanged($, e.key, result.value)
    }
    return result
  }).catch((_$, e, next) => next(e))

  // An observer: if it fails, the close goes on.
  on('ui.close', { id: PANE_ID }, (_$, e, next) => {
    stopPoll()
    return next(e)
  }).catch((_$, e, next) => next(e))

  // The model request is the engine's work, not the mod's: a failed write of
  // the mod's own state only logs, and never fails the request.
  on('turn.step', async function* ($, e, next) {
    // A step with an agentId belongs to a subagent, not the main session.
    if (e.agentId !== undefined) return yield* timed($, next(e), result => recordUsage($, e, result))
    await observe($, 'the model of a step', () => dispatch($, { kind: 'model-used', model: e.model }))
    const sentAt = await $.clock.now()
    return yield* timed($, next(e), async (result, firstAt) => {
      await recordUsage($, e, result)
      if (result.usage === null) return
      const usage = result.usage
      await observe($, 'the timing of a step', async () => {
        const end = await $.clock.now()
        await dispatch($, {
          kind: 'step-timed',
          // The output time starts at the first chunk: the wait before it, and
          // any retry before a chunk came, is not output.
          step: firstAt === null ? null : { outputTokens: usage.output_tokens, ms: end - firstAt },
          model: e.model,
          sentAt,
          cacheUsed: usage.cache_read_input_tokens + usage.cache_creation_input_tokens > 0,
        })
      })
    })
  })

  // Observers: if one fails, the prompt or the switch goes on. The turn cost
  // counts from a prompt that the user sent, as the engine's turn count does;
  // a notification or a schedule that wakes the loop does not start a turn.
  on('prompt.submit', async ($, e, next) => {
    if (USER_ORIGINS.has(e.origin.kind)) {
      await observe($, 'the cost at a prompt', async () =>
        dispatch($, { kind: 'prompt-sent', costUsd: (await $.session.usage()).cost?.usd ?? null }),
      )
    }
    return next(e)
  }).catch((_$, e, next) => next(e))

  // The engine tells the cache TTL only here. The mod does not guess it at other times.
  on('classic.PostModelSwitch', async ($, e, next) => {
    await observe($, 'the model switch', () =>
      dispatch($, { kind: 'model-switched', model: e.to_model, cacheTtlMs: cacheTtlMs(e.cache_ttl) }),
    )
    return next(e)
  }).catch((_$, e, next) => next(e))

  // A /clear or a resume ends the conversation without a new session.start;
  // the token sums start again, as the engine's cost and time do.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear' || e.reason === 'resume') {
      await dispatchUsage($, { kind: 'usage-reset' })
      await dispatch($, { kind: 'conversation-replaced' })
    }
    return next(e)
  }).catch((_$, e, next) => next(e))

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
