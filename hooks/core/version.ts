// Function hooks are an early-access API: the mod runs only on engine
// versions it was tested against.
export const MIN_ENGINE_VERSION = '2.1.300'

type Triple = readonly [number, number, number]

function parse(version: string): Triple | null {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version)
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

// A development build of a release (`2.1.300-dev`) counts as that release.
// A version that does not parse is not supported.
export function isSupportedEngine(version: string, minimum: string = MIN_ENGINE_VERSION): boolean {
  const have = parse(version)
  const need = parse(minimum)
  if (!have || !need) return false
  for (let i = 0; i < 3; i++) {
    if (have[i]! !== need[i]!) return have[i]! > need[i]!
  }
  return true
}
