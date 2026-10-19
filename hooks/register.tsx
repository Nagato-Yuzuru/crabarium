import type { Register } from 'claude-code'

import { registerCollect } from './collect'
import { settingsFromOptions } from './core/avatar/settings'
import { motionMode } from './core/character'
import { registerPane } from './view/pane'

export const register: Register = (on, options) => {
  registerCollect(on, settingsFromOptions(options))
  registerPane(on, motionMode(options.motion))
}
