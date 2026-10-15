import type { Register } from 'claude-code'

import { registerCollect } from './collect'
import { motionMode } from './core/character'
import { registerPane } from './view/pane'

export const register: Register = (on, options) => {
  registerCollect(on)
  registerPane(on, motionMode(options.motion))
}
