// The built-in motions. They move only `*`, the whole character, so they work
// on each pack. A pack motion with the same name replaces one.
import type { CharacterState, Motion } from './pack.ts'

const UP = { offset: { '*': [0, -1] } } as const

export const BUILTIN_MOTIONS: Readonly<Record<string, Motion>> = {
  walk: { fps: 6, loop: true, frames: [UP, {}] },
  bob: { fps: 2, loop: true, frames: [{}, UP] },
  float: { fps: 3, loop: true, frames: [{}, UP, { offset: { '*': [0, -2] } }, UP] },
  swing: { fps: 4, loop: true, frames: [{ offset: { '*': [-1, 0] } }, {}, { offset: { '*': [1, 0] } }, {}] },
}

/** The motion of each state when the pack does not name one. Finished and failed stand still. */
export const DEFAULT_STATES: Readonly<Partial<Record<CharacterState, string>>> = {
  entering: 'walk',
  working: 'walk',
  idle: 'bob',
  leaving: 'walk',
}
