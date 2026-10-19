import type { Register } from 'claude-code'

import { registerCollect } from './collect.ts'
import { settingsFromOptions } from './core/avatar/settings.ts'
import { motionMode } from './core/character.ts'
import { registerPane } from './view/pane.tsx'

export const register: Register = (on, options) => {
  registerCollect(on, settingsFromOptions(options))
  registerPane(on, motionMode(options.motion))
}
