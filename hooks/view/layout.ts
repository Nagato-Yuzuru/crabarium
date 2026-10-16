// The pane layout model: which blocks show at a width, and the agents as
// trees. Pure: the time and the width come in as arguments. The terminal and
// the Svg renderer draw the same model.
import { durationMs, isEnded } from '../core/agents'
import type { AgentBoard, AgentRow, AgentStatus } from '../core/agents'
import type { MainSession } from '../core/session'

/** The narrowest body, in columns, at which each block still shows. */
export const STEP = { cards: 64, small: 56, character: 48 } as const
/** The most finished trees that the pane shows; the others fold into "+ N earlier". */
export const FINISHED_TREES = 5
/** How long an ended subagent stays in its live tree before it folds. */
export const LINGER_MS = 3000

/** The blocks that show. */
export type Steps = { cards: boolean; small: boolean; character: boolean }

/**
 * The blocks for a body `columns` wide. Without Rasters (any surface but the
 * terminal, until the Svg renderer) no character shows at any width.
 */
export function stepsFor(columns: number, hasRaster: boolean): Steps {
  return {
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

/** The model name without the "claude-" of a first-party id. Another id (a Bedrock id, for example) stays whole. */
export function shortModel(id: string): string {
  return id.replace(/^claude-/, '')
}

export type Stat = { label: 'cost' | 'tokens' | 'time'; value: string | null }

export type Header = { model: string; context: string; stats: readonly Stat[] }

/** The time card counts to the last usage read, so it moves with the poll. */
export function header(session: MainSession): Header {
  return {
    model: session.model === null ? UNKNOWN : shortModel(session.model),
    context: session.contextPercent === null ? UNKNOWN : `${Math.round(session.contextPercent)}%`,
    stats: [
      { label: 'cost', value: session.costUsd === null ? null : `$${session.costUsd.toFixed(2)}` },
      // The usage figures come later; until then the card shows that the value is unknown.
      { label: 'tokens', value: null },
      {
        label: 'time',
        value:
          session.startedAt === null || session.readAt === null ? null : formatDuration(Math.max(0, session.readAt - session.startedAt)),
      },
    ],
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

function line(row: AgentRow, now: number, extra: readonly string[], character: CharacterSize | null): AgentLine {
  // A narrow line cuts from the end, so the duration and the counts come first.
  const detail = [formatDuration(durationMs(row, now)), ...extra, row.type, shortModel(row.model)].join(' · ')
  return { id: row.id, description: row.description, status: row.status, detail, character }
}

function liveTree(node: Node, now: number, steps: Steps): Tree {
  // An ended subagent stays for LINGER_MS, so its end does not vanish at once.
  const shows = (child: Node): boolean => isLive(child) || now - endOf(child) < LINGER_MS
  const shown = node.children.filter(shows)
  const ended = node.children.filter(c => !shows(c))
  const children = shown.map(child => {
    // Agents below the subagents fold into a count, as the status line folds them.
    const deeper = child.children.flatMap(all)
    const running = deeper.filter(r => r.status === 'running').length
    const nested = deeper.length === 0 ? [] : [`+${deeper.length} nested${running > 0 ? `, ${running} running` : ''}`]
    return line(child.row, now, nested, steps.small ? 'small' : null)
  })
  // The counts cover the folded agents at every depth, so a nested failure still shows.
  const foldedRows = ended.flatMap(all)
  const count = (status: AgentStatus): number => foldedRows.filter(r => r.status === status).length
  const folded: Folded | null =
    ended.length === 0
      ? null
      : { completed: count('completed'), failed: count('failed'), killed: count('killed'), agents: foldedRows.length }
  return { root: line(node.row, now, [], steps.character ? 'full' : null), children, folded }
}

function finishedTree(node: Node, now: number, steps: Steps): Tree {
  const below = all(node).length - 1
  return {
    root: line(node.row, now, below === 0 ? [] : [plural(below, 'subagent')], steps.character ? 'full' : null),
    children: [],
    folded: null,
  }
}

export function paneLayout(board: AgentBoard, session: MainSession, now: number, columns: number, hasRaster: boolean): PaneLayout {
  const steps = stepsFor(columns, hasRaster)
  const trees = forest(board.rows)
  const live = trees.filter(isLive)
  // Newest first: the tree whose last agent ended last.
  const ended = trees.filter(t => !isLive(t)).toSorted((a, b) => endOf(b) - endOf(a))
  const groups: Group[] = [
    // Running counts the live agents; Finished counts every agent of its trees.
    { title: 'Running', agents: live.flatMap(all).filter(r => !isEnded(r.status)).length, trees: live.map(t => liveTree(t, now, steps)) },
    { title: 'Finished', agents: ended.flatMap(all).length, trees: ended.slice(0, FINISHED_TREES).map(t => finishedTree(t, now, steps)) },
  ]
  const shown = groups.flatMap(g => g.trees.flatMap(t => [t.root, ...t.children]))
  return {
    steps,
    header: header(session),
    groups: groups.filter(g => g.trees.length > 0),
    earlier: Math.max(0, ended.length - FINISHED_TREES),
    characters: shown.flatMap(l => (l.character === null ? [] : [{ id: l.id, size: l.character }])),
  }
}
