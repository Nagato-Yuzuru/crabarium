// The engine's state scan reads each `$.state` reference in the file that
// uses it, so each user declares its atom itself; types/index.d.ts holds them
// to one contract.
export const PANE_ID = 'crabarium'

/**
 * The shape tag of the session value. A hot reload keeps `$.state`, so a
 * change to `MainSession` takes a new tag: the new code then reads the old
 * value as absent and starts from the initial one.
 */
export const SESSION_SHAPE = 'session-2'
