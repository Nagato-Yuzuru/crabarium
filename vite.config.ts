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

const generated = ['.claude-plugin/types/', 'hooks/packs.generated.ts', 'hooks/vendor/']

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

      // Promises: an error must reach a handler, with its stack.
      'typescript/no-misused-promises': 'error',
      'typescript/return-await': 'error',
      'typescript/only-throw-error': 'error',
      'typescript/prefer-promise-reject-errors': 'error',
      'typescript/use-unknown-in-catch-callback-variable': 'error',

      // `any` must not travel: each use of an untyped value is a decision.
      'typescript/no-explicit-any': 'error',
      'typescript/no-unsafe-argument': 'error',
      'typescript/no-unsafe-assignment': 'error',
      'typescript/no-unsafe-call': 'error',
      'typescript/no-unsafe-member-access': 'error',
      'typescript/no-unsafe-return': 'error',

      // The function hooks API is early access; a deprecation in the engine
      // types is a change to make before the API goes away.
      'typescript/no-deprecated': 'error',

      'typescript/no-unnecessary-condition': 'error',
      'typescript/strict-boolean-expressions': 'error',
      'typescript/restrict-plus-operands': 'error',
      eqeqeq: 'error',
      'import/no-cycle': 'error',
    },
    overrides: [
      {
        // The core is pure (the RFC's three layers): it reads no view code,
        // and it reaches the engine only through types.
        files: ['hooks/core/**'],
        rules: {
          'typescript/no-restricted-imports': [
            'error',
            {
              patterns: [{ group: ['**/view/**', '**/view'], message: 'The core does not read the view layer.' }],
              paths: [
                { name: 'claude-code', message: 'The core does not call the engine; import its types only.', allowTypeImports: true },
              ],
            },
          ],
        },
      },
      {
        // The engine's console is not a standard one; the mod logs with $.ui.log.
        files: ['hooks/**'],
        rules: { 'no-console': 'error' },
      },
      {
        // A test builds engine answers and fixtures by hand; the assertion or
        // the untyped edit is the fixture's claim, and the test checks it.
        files: ['tests/**'],
        rules: {
          'typescript/no-unsafe-type-assertion': 'off',
          'typescript/no-explicit-any': 'off',
          'typescript/no-unsafe-assignment': 'off',
          'typescript/no-unsafe-member-access': 'off',
        },
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
