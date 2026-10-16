// The context window of each Claude model, for a subagent's context percent.
// The engine gives the window of the session's own model only, and a
// subagent can run another model. Pure data: no engine calls.
//
// Source, read on 2026-10-16:
//   https://platform.claude.com/docs/en/about-claude/models/overview
// To update: read the page, change the rows and the date above, and run the
// tests. A model that is not here shows "?", never a wrong number.
//
// There is no price table, so the pane shows no cost for a single agent. The
// engine gives only the session total. A price table would be a guess: the
// usage does not say which cache writes were 5-minute and which were 1-hour,
// Bedrock and Vertex have their own prices, and list prices change.

const M = 1_000_000

/** Tokens, by model id. */
export const CONTEXT_WINDOWS: Readonly<Record<string, number>> = {
  'claude-fable-5-1': M,
  'claude-mythos-5-1': M,
  'claude-fable-5': M,
  'claude-mythos-5': M,
  'claude-opus-5-5': M,
  'claude-opus-5': M,
  'claude-opus-4-8': M,
  'claude-opus-4-7': M,
  'claude-opus-4-6': M,
  'claude-sonnet-5-5': M,
  'claude-sonnet-5': M,
  'claude-sonnet-4-6': M,
  'claude-haiku-5-5': M,
  'claude-haiku-4-5': 200_000,
}

// A known id inside a reported id: after a provider prefix
// (`us.anthropic.`) or at the start, and before the end, a `[1m]` or `@`
// suffix, a date, or a version (`-v1:0`). So `claude-opus-5-9` matches no row:
// it is not `claude-opus-5` with a suffix, but a model that the table lacks.
const MATCHERS = Object.keys(CONTEXT_WINDOWS).map(id => ({
  id,
  pattern: new RegExp(`(?:^|[.:/])${id}(?:$|[\\[@]|-\\d{8}|-v\\d)`),
}))

/** The window of a model id as the API reports it, or `null` for a model that the table lacks. */
export function contextWindowOf(model: string): number | null {
  const match = MATCHERS.find(m => m.pattern.test(model))
  return match === undefined ? null : CONTEXT_WINDOWS[match.id]!
}

/** All the input kinds of a request: what the context percent counts. */
export function promptTokens(t: { input: number; cacheRead: number; cacheWrite: number }): number {
  return t.input + t.cacheRead + t.cacheWrite
}
