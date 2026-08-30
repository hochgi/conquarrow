import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * The purity guard.
 *
 * ADR 0001 and AGENTS.md: no clocks, no randomness, no I/O anywhere in the
 * rules core. This is a product property, not a testing convenience — SPEC.md
 * contains no randomness by design, and the appeal of the multi-prong bonus and
 * the spawner rhythm is that an attentive player can compute them.
 *
 * This catches the loud violations. It does NOT catch every realistic one —
 * iteration over an unordered collection feeding an ordered decision still
 * slips through. The `? -1 : 1` sort shape is now a syntax error below; other
 * ties that break on identity still pass every unit test and surface only as
 * replay drift, which is why P10 lands early.
 */
const impureGlobals = [
  { name: 'Date', message: 'The core is pure (ADR 0001). No clocks.' },
  { name: 'fetch', message: 'The core is pure (ADR 0001). No I/O.' },
  { name: 'crypto', message: 'The core is pure (ADR 0001). No randomness.' },
  { name: 'process', message: 'The core is pure (ADR 0001). No environment.' },
];

const impureProperties = [
  { object: 'Math', property: 'random', message: 'The core is pure (ADR 0001). No randomness.' },
  { object: 'Date', property: 'now', message: 'The core is pure (ADR 0001). No clocks.' },
  {
    object: 'performance',
    property: 'now',
    message: 'The core is pure (ADR 0001). No clocks.',
  },
];

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/*.d.ts',
      'packages/web/dist/**',
      'tools/byok-turn-runner/**',
      'scripts/**',
      'reports/**',
      'coverage/**',
      '.stryker-tmp/**',
      // Throwaway visual validation (gitignored) — never part of the build.
      '**/.scratch/**',
      // Installed agent skills are templates (markdown, yaml, sample configs),
      // not product code. A skill .cjs is otherwise picked up by type-aware
      // lint and fails projectService because it is in no tsconfig.
      '.agents/**',
      '.claude/skills/**',
      // A nested git worktree is a second checkout of this repo, not product
      // code. Linting it lints every package twice and fails projectService on
      // its own config files, which are in no tsconfig of *this* checkout.
      '.claude/worktrees/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          // Root tooling config lives outside any package's tsconfig.
          allowDefaultProject: [
            'vitest.config.ts',
            'packages/web/vite.config.ts',
            'packages/online-api/test/infra.test.ts',
          ],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Phase-2 skeletons name their parameters so the signature documents
      // itself, then ignore them. `_`-prefixed is the marker.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // `a < b ? -1 : 1` is not a total order: equal keys return 1, so a sort
      // is formally free to shuffle them. ADR 0001 names that as the realistic
      // determinism failure — it passes every unit test and shows up as replay
      // drift. Return 0 for equals (`a < b ? -1 : a > b ? 1 : 0`).
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "ConditionalExpression[consequent.type='UnaryExpression'][consequent.operator='-'][consequent.argument.raw='1'][alternate.raw='1']",
          message:
            'Sort comparators must be total (ADR 0001): return 0 for equal keys. `a < b ? -1 : 1` claims a strict order between equals.',
        },
      ],
    },
  },
  {
    // The core, its contracts, and every geometry implementation behind the
    // port. Adapters (renderer, input) are exempt — they are where the impure
    // world is supposed to live.
    //
    // Geometry belongs here even though it is not "the core": a board that
    // answered differently on two calls would desync a replay just as surely as
    // a rule that did, and the generated tiling is a pure function of an
    // identifier precisely so that it cannot.
    files: [
      'packages/contracts/**/*.ts',
      'packages/rules-core/**/*.ts',
      'packages/geometry-*/**/*.ts',
    ],
    rules: {
      'no-restricted-globals': ['error', ...impureGlobals],
      'no-restricted-properties': ['error', ...impureProperties],
    },
  },
  {
    // `no-restricted-globals` above only catches the *global* binding, so
    // `import process from 'node:process'` walks straight past it — and that is
    // exactly what a developer blocked by the global rule reaches for next. Found
    // by probe during P37 review, where a regex on one file's text was the only
    // thing standing in the way. A Node builtin has no business in a pure core in
    // any spelling.
    //
    // `src` only, deliberately: the purity guard's own tests read source files off
    // disk and load replay fixtures, which is what `node:fs` is for. Tests are
    // adapters to the filesystem, not core.
    files: [
      'packages/contracts/src/**/*.ts',
      'packages/rules-core/src/**/*.ts',
      'packages/geometry-*/src/**/*.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['node:*'],
              message: 'The core is pure (ADR 0001). No Node builtins, imported or global.',
            },
          ],
        },
      ],
    },
  },
  {
    // Production-code complexity ratchet (P24). Warn-only. Tests are exempt —
    // Gherkin scenarios are allowed to be long. Do not flip to error until
    // boy-scouting has brought the core under budget. Coverage can hide high
    // complexity in CRAP — this is the number we will eventually gate.
    files: [
      'packages/contracts/src/**/*.ts',
      'packages/rules-core/src/**/*.ts',
      'packages/geometry-*/src/**/*.ts',
    ],
    rules: {
      complexity: ['warn', 12],
      'max-depth': ['warn', 4],
      'max-lines-per-function': ['warn', { max: 80, skipBlankLines: true, skipComments: true }],
      'max-params': ['warn', 5],
    },
  },
  {
    // Root tooling config. Type-aware linting buys nothing here and these files
    // sit outside every package's tsconfig by design.
    files: [
      '**/*.js',
      '**/*.cjs',
      '**/*.mjs',
      'vitest.config.ts',
      'packages/web/vite.config.ts',
      'packages/online-api/test/infra.test.ts',
    ],
    ...tseslint.configs.disableTypeChecked,
  },
);
