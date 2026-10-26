// eslint.config.js
import tseslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import svelte from 'eslint-plugin-svelte';
import svelteConfig from './svelte.config.js';

export default [
  {
    // The .cjs generators are CommonJS by design (require/module.exports);
    // TS-recommended rules would fight them for no gain. Reference Projects/
    // is gitignored third-party material, not ours to lint. The advisor vendor/
    // dir is frozen third-party UMD (shizukaziye's DP + scoring core), likewise.
    // public/tesseract/ holds tesseract.js runtime files copied from node_modules
    // (scripts/copy-tesseract.cjs), also third-party.
    ignores: [
      'dist/',
      'node_modules/',
      '**/*.cjs',
      'Reference Projects/',
      'src/lib/**/vendor/**',
      'public/tesseract/',
    ],
  },

  // typescript-eslint recommended set — catches, among others, the
  // unused-expression class of bug (a some() callback body with no return).
  ...tseslint.configs['flat/recommended'],

  {
    files: ['**/*.{js,ts,mts}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module'
      }
    },
    plugins: {
      '@typescript-eslint': tseslint
    },
    rules: {
      '@typescript-eslint/no-unused-expressions': 'error',
      // The OpenCV.js bindings and test-side private-member access are
      // inherently `any`-shaped; forcing annotations there adds noise, not
      // safety. The rest of the recommended set stays on.
      '@typescript-eslint/no-explicit-any': 'off'
    }
  },

  // Svelte components and rune modules. Must come after the TS block above,
  // which also matches *.svelte.ts and would otherwise reset its parser.
  ...svelte.configs.recommended,

  {
    files: ['**/*.svelte', '**/*.svelte.ts'],
    languageOptions: {
      parserOptions: {
        parser: tsParser,
        extraFileExtensions: ['.svelte'],
        svelteConfig
      }
    },
    rules: {
      '@typescript-eslint/no-unused-expressions': 'error',
      '@typescript-eslint/no-explicit-any': 'off',
      // Keys only matter for lists that reorder or animate; the one that does
      // (ArkGridGemList) is already keyed, and the rest iterate fixed option
      // lists or short rows of stateless buttons and text.
      'svelte/require-each-key': 'off'
    }
  },

  // Worker-only rules
  {
    files: ['src/lib/cv/**/*.{js,ts}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            'svelte',
            'svelte/store',
            'svelte/internal'
          ],
          patterns: ['**/*.svelte']
        }
      ]
    }
  }
];
