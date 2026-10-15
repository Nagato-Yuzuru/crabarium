import type { Register } from 'claude-code'

import { registerCollect } from './collect'
import { registerPane } from './view/pane'

export const register: Register = on => {
  registerCollect(on)
  registerPane(on)
}
