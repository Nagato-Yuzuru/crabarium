// The state contract. The engine requires it to be self-contained, so the
// domain types that live in `$.state` are declared here and the core imports them.

/** The main session as the pane shows it; `null` is unknown. */
export type MainSession = {
  model: string | null
  contextPercent: number | null
  costUsd: number | null
}

declare module 'claude-code' {
  interface PluginState {
    crabarium: { session: MainSession }
  }
}
