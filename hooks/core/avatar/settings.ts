// The `userConfig` values that the pane draws with, as the state holds them.
import type { AvatarSettings } from '../../../types'
import { avatarMode } from './select.ts'

export type { AvatarSettings }

/** The pack that a new install shows, and the one that the pane falls back to. */
export const DEFAULT_PACK = 'minimal'

export const initialSettings: AvatarSettings = { pack: DEFAULT_PACK, avatarMode: 'keywords', avatarRules: '' }

/** The settings from the plugin options; a missing or wrong value takes its default. */
export function settingsFromOptions(options: Readonly<Record<string, unknown>>): AvatarSettings {
  const pack = typeof options.pack === 'string' && options.pack.trim() !== '' ? options.pack.trim() : DEFAULT_PACK
  const rules = typeof options.avatarRules === 'string' ? options.avatarRules : ''
  return { pack, avatarMode: avatarMode(options.avatarMode), avatarRules: rules }
}
