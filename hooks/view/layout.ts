// The pane layout model: which blocks show at a width, and the agents as
// trees. Pure: the time and the width come in as arguments. The terminal and
// the Svg renderer draw the same model.
import { durationMs, isEnded } from '../core/agents.ts'
import type { AgentBoard, AgentRow, AgentStatus } from '../core/agents.ts'
import { cacheLeftMs, tokensPerSecond, turnCost } from '../core/session.ts'
import type { MainSession, RateLimit } from '../core/session.ts'
import { cacheHitRate, contextPercent, newTokens, sessionSums } from '../core/usage/usage.ts'
import type { AgentUsage, UsageBoard } from '../core/usage/usage.ts'

/** The narrowest body, in columns, at which each block still shows. */
export const STEP = { figures: 80, cards: 64, small: 56, character: 48 } as const
/** The most finished trees that the pane shows; the others fold into "+ N earlier". */
export const FINISHED_TREES = 5
/** How long an ended subagent stays in its live tree before it folds. */
export const LINGER_MS = 3000

/** The blocks that show. `figures` is the usage figures on line 2 of each agent row. */
export type Steps = { figures: boolean; cards: boolean; small: boolean; character: boolean }

/**
 * The blocks for a body `columns` wide. Without Rasters (any surface but the
 * terminal, until the Svg renderer) no character shows at any width.
 */
export function stepsFor(columns: number, hasRaster: boolean): Steps {
  return {
    figures: columns >= STEP.figures,
    cards: columns >= STEP.cards,
    small: hasRaster && columns >= STEP.small,
    character: hasRaster && columns >= STEP.character,
  }
}

const UNKNOWN = '—'

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

/** A token count in three significant digits: 512, 48.2k, 212k, 1.24M. */
export function formatTokens(n: number): string {
  if (n < 1000) return String(Math.round(n))
  const k = Number((n / 1000).toPrecision(3))
  // 999,500 rounds to 1000k: that is 1M.
  return k < 1000 ? `${k}k` : `${Number((n / 1_000_000).toPrecision(3))}M`
}

/** An effort word as it is; a number is a thinking budget in tokens. */
export function formatEffort(effort: string): string {
  return /^\d+$/.test(effort) ? `budget ${formatTokens(Number(effort))}` : effort
}

/** The model name without the "claude-" of a first-party id. Another id (a Bedrock id, for example) stays whole. */
export function shortModel(id: string): string {
  return id.replace(/^claude-/, '')
}

function formatUsd(usd: number): string {
  return `$${usd.toFixed(2)}`
}

/** A countdown as minutes and seconds: 4:05, 59:59. */
export function formatCountdown(ms: number): string {
  const s = Math.ceil(ms / 1000)
  return `${Math.floor(s / 60)}:${pad(s % 60)}`
}

/** The short names of the windows that the engine names; another kind shows as it is. */
const WINDOW_NAMES: Readonly<Record<string, string>> = { five_hour: '5h', seven_day: '7d' }

/** A rate-limit window as the pane shows it: `5h` and `23%`. */
export type Limit = { name: string; used: string }

// Rounded down, so a window never shows as full before it is.
function limit(r: RateLimit): Limit {
  return { name: WINDOW_NAMES[r.kind] ?? r.kind.replaceAll('_', ' '), used: `${Math.floor(r.percentUsed)}%` }
}

/** A card: its label, its value, and a detail line below the value. */
export type Stat = { label: 'cost' | 'agent tokens' | 'time'; value: string | null; detail?: string }

export type Header = {
  model: string
  context: string
  /** How the main session runs now: tokens per second, the cache countdown. Each shows only when it is known. */
  live: readonly string[]
  stats: readonly Stat[]
  /** The rate-limit windows; empty off a subscription, and then no limits card shows. */
  limits: readonly Limit[]
}

function detail(text: string | null): { detail?: string } {
  return text === null ? {} : { detail: text }
}

/** The time card counts to the last usage read, so it moves with the poll. The cache countdown counts to `now`. */
export function header(session: MainSession, usage: UsageBoard, now: number): Header {
  const sums = sessionSums(usage)
  const hit = sums === null ? null : cacheHitRate(sums)
  const turn = turnCost(session)
  const tps = tokensPerSecond(session.lastStep)
  const cache = cacheLeftMs(session.cache, now)
  return {
    model: session.model === null ? UNKNOWN : shortModel(session.model),
    context: session.contextPercent === null ? UNKNOWN : `${Math.round(session.contextPercent)}%`,
    live: [
      ...(tps === null ? [] : [`${Math.round(tps)} tok/s`]),
      ...(cache === null ? [] : [cache === 0 ? 'cache cold' : `cache ${formatCountdown(cache)}`]),
    ],
    stats: [
      // The turn cost is the engine's session cost since the turn began, so it holds the subagents that ran in that time.
      {
        label: 'cost',
        value: session.costUsd === null ? null : formatUsd(session.costUsd),
        ...detail(turn === null ? null : `turn ${formatUsd(turn)}`),
      },
      // The engine gives the session cost. The tokens are the mod's own sum of
      // the agents' requests: the main session and its subagents. The engine's
      // own requests (a session title, for example) do not reach a plugin, so
      // the cost holds them and the tokens do not. The label says so.
      {
        label: 'agent tokens',
        value: sums === null ? null : formatTokens(newTokens(sums)),
        ...detail(hit === null ? null : `${Math.round(hit)}% hit`),
      },
      {
        label: 'time',
        value:
          session.startedAt === null || session.readAt === null ? null : formatDuration(Math.max(0, session.readAt - session.startedAt)),
        ...detail(session.turns === null ? null : plural(session.turns, 'turn')),
      },
    ],
    limits: session.rateLimits.map(limit),
  }
}

export type CharacterSize = 'full' | 'small'

/** One agent as a row: line 1 is the description and the status, line 2 the detail. */
export type AgentLine = {
  id: string
  description: string
  status: AgentStatus
  detail: string
  character: CharacterSize | null
}

/** The ended subagents of a live tree, folded into one line. */
export type Folded = { completed: number; failed: number; killed: number; agents: number }

/** A main-loop agent and, while its tree is live, its own subagents. */
export type Tree = { root: AgentLine; children: readonly AgentLine[]; folded: Folded | null }

export type Group = { title: 'Running' | 'Finished'; agents: number; trees: readonly Tree[] }

/** A character that the layout shows: whose, and how large. */
export type ShownCharacter = { id: string; size: CharacterSize }

export type PaneLayout = {
  steps: Steps
  header: Header
  groups: readonly Group[]
  /** Finished trees that do not show. */
  earlier: number
  /** Each character that shows, for the frame loop. */
  characters: readonly ShownCharacter[]
}

type Node = { row: AgentRow; children: readonly Node[] }

// The state is a flat list with a parent id; the tree is derived here. A row
// whose parent is not in the list (spawned before the mod listened) is a root.
// A resume records the agent that resumed a row as its parent, so the ids can
// make a cycle (a1 spawns a2, then a2 resumes a1). The edges join in list
// order, and an edge that would close a cycle is dropped: that row is a root.
function forest(rows: readonly AgentRow[]): readonly Node[] {
  const ids = new Set(rows.map(r => r.id))
  const parentOf = new Map<string, string>()
  const reaches = (from: string, target: string): boolean => {
    for (let id: string | undefined = from; id !== undefined; id = parentOf.get(id)) if (id === target) return true
    return false
  }
  const children = new Map<string, AgentRow[]>()
  const roots: AgentRow[] = []
  for (const row of rows) {
    const parent = row.parentId
    if (parent !== null && ids.has(parent) && !reaches(parent, row.id)) {
      parentOf.set(row.id, parent)
      children.set(parent, [...(children.get(parent) ?? []), row])
    } else {
      roots.push(row)
    }
  }
  const node = (row: AgentRow): Node => ({ row, children: (children.get(row.id) ?? []).map(node) })
  return roots.map(node)
}

function all(node: Node): readonly AgentRow[] {
  return [node.row, ...node.children.flatMap(all)]
}

function isLive(node: Node): boolean {
  return all(node).some(r => !isEnded(r.status))
}

function endOf(node: Node): number {
  return Math.max(...all(node).map(r => r.endedAt ?? r.startedAt))
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

// The usage figures of an agent: its tokens and its context percent, "?" when
// the window of its model is unknown. No cost: the engine gives only the
// session total, and an estimate from list prices can be far off (see
// hooks/core/usage/models.ts).
function figures(u: AgentUsage): readonly string[] {
  const context = contextPercent(u.last)
  return [`${formatTokens(newTokens(u.tokens))} tok`, `ctx ${context === null ? '?' : `${Math.round(context)}%`}`]
}

type Context = { now: number; steps: Steps; usage: UsageBoard }

function line(row: AgentRow, c: Context, extra: readonly string[], character: CharacterSize | null): AgentLine {
  const usage = c.usage.agents[row.id]
  // The model, the effort and the context percent all describe the last request,
  // which can be another model than the spawn named (a fallback, a hook).
  const last = usage?.last
  const model = last === undefined ? shortModel(row.model) : shortModel(last.model)
  const effort = last?.effort
  const label = effort === undefined || effort === null ? model : `${model} ${formatEffort(effort)}`
  // A narrow line cuts from the end, so the duration and the counts come first.
  const parts = [
    formatDuration(durationMs(row, c.now)),
    ...extra,
    row.type,
    label,
    ...(c.steps.figures && usage !== undefined ? figures(usage) : []),
  ]
  return { id: row.id, description: row.description, status: row.status, detail: parts.join(' · '), character }
}

function liveTree(node: Node, c: Context): Tree {
  const { now, steps } = c
  // An ended subagent stays for LINGER_MS, so its end does not vanish at once.
  const shows = (child: Node): boolean => isLive(child) || now - endOf(child) < LINGER_MS
  const shown = node.children.filter(shows)
  const ended = node.children.filter(child => !shows(child))
  const children = shown.map(child => {
    // Agents below the subagents fold into a count, as the status line folds them.
    const deeper = child.children.flatMap(all)
    const running = deeper.filter(r => r.status === 'running').length
    const nested = deeper.length === 0 ? [] : [`+${deeper.length} nested${running > 0 ? `, ${running} running` : ''}`]
    return line(child.row, c, nested, steps.small ? 'small' : null)
  })
  // The counts cover the folded agents at every depth, so a nested failure still shows.
  const foldedRows = ended.flatMap(all)
  const count = (status: AgentStatus): number => foldedRows.filter(r => r.status === status).length
  const folded: Folded | null =
    ended.length === 0
      ? null
      : { completed: count('completed'), failed: count('failed'), killed: count('killed'), agents: foldedRows.length }
  return { root: line(node.row, c, [], steps.character ? 'full' : null), children, folded }
}

function finishedTree(node: Node, c: Context): Tree {
  const below = all(node).length - 1
  return {
    root: line(node.row, c, below === 0 ? [] : [plural(below, 'subagent')], c.steps.character ? 'full' : null),
    children: [],
    folded: null,
  }
}

export function paneLayout(
  board: AgentBoard,
  session: MainSession,
  usage: UsageBoard,
  now: number,
  columns: number,
  hasRaster: boolean,
): PaneLayout {
  const steps = stepsFor(columns, hasRaster)
  const c: Context = { now, steps, usage }
  const trees = forest(board.rows)
  const live = trees.filter(isLive)
  // Newest first: the tree whose last agent ended last.
  const ended = trees.filter(t => !isLive(t)).toSorted((a, b) => endOf(b) - endOf(a))
  const groups: Group[] = [
    // Running counts the live agents; Finished counts every agent of its trees.
    { title: 'Running', agents: live.flatMap(all).filter(r => !isEnded(r.status)).length, trees: live.map(t => liveTree(t, c)) },
    { title: 'Finished', agents: ended.flatMap(all).length, trees: ended.slice(0, FINISHED_TREES).map(t => finishedTree(t, c)) },
  ]
  const shown = groups.flatMap(g => g.trees.flatMap(t => [t.root, ...t.children]))
  return {
    steps,
    header: header(session, usage, now),
    groups: groups.filter(g => g.trees.length > 0),
    earlier: Math.max(0, ended.length - FINISHED_TREES),
    characters: shown.flatMap(l => (l.character === null ? [] : [{ id: l.id, size: l.character }])),
  }
}
