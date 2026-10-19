import { existsSync } from 'node:fs'
import { defineConfig } from 'vite-plus'

// The engine writes its types into .claude-plugin/types/ when an interactive
// session loads the mod. Without them (CI, a fresh clone), type-aware rules
// and the type check would fail on every import of 'claude-code', so they run
// only where the types exist.
const hasEngineTypes = existsSync('.claude-plugin/types/claude-code/index.d.ts')
if (!hasEngineTypes) {
  console.warn('No engine types in .claude-plugin/types/: type-aware lint and the type check are off. Run pnpm dev once to get them.')
}

const generated = ['.claude-plugin/types/', 'hooks/packs.generated.ts']

export default defineConfig({
  lint: {
    plugins: ['typescript', 'unicorn', 'oxc', 'import', 'promise'],
    categories: {
      correctness: 'error',
      suspicious: 'error',
      perf: 'error',
    },
    env: { es2024: true },
    rules: {
      // A leading `_` marks a hook argument the hook does not use.
      'no-underscore-dangle': 'off',
      // `on(...).catch(handler)` registers a hook's fallback; it is not Promise#catch.
      'promise/no-callback-in-promise': 'off',
      // A switch over a union returns in each case; the type checker proves
      // that, and switch-exhaustiveness-check keeps it true.
      'typescript/consistent-return': 'off',
      'typescript/switch-exhaustiveness-check': 'error',
      // Pack rows split into code points on purpose: a palette key is one
      // printable ASCII character, so no key spans two code points.
      'typescript/no-misused-spread': 'off',
    },
    overrides: [
      {
        // A test builds engine answers and fixtures by hand; the assertion
        // is the fixture's claim, and the test checks it.
        files: ['tests/**'],
        rules: { 'typescript/no-unsafe-type-assertion': 'off' },
      },
      {
        // The schema validator walks untrusted JSON; each assertion follows
        // the runtime check of that schema keyword.
        files: ['hooks/core/pack/validate.ts'],
        rules: { 'typescript/no-unsafe-type-assertion': 'off' },
      },
    ],
    ignorePatterns: generated,
    options: {
      typeAware: hasEngineTypes,
      typeCheck: hasEngineTypes,
    },
  },
  fmt: {
    printWidth: 140,
    semi: false,
    singleQuote: true,
    arrowParens: 'avoid',
    trailingComma: 'all',
    sortImports: {
      groups: [
        ['builtin', 'external'],
        ['parent', 'sibling', 'index'],
      ],
    },
    sortPackageJson: false,
    ignorePatterns: [...generated, 'pnpm-lock.yaml', 'schema/pack.schema.json'],
  },
})
