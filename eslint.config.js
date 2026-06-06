// eslint.config.js
import tseslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

export default [
  {
    files: ['**/*.{js,ts}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module'
      }
    },
    plugins: {
      '@typescript-eslint': tseslint
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
