import js from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import unusedImports from 'eslint-plugin-unused-imports';
import globals from 'globals';

export default [
  // 1. Global Ignores
  {
    ignores: ['node_modules/', 'dist/', 'build/'],
  },

  // 2. Recommended JS Rules
  js.configs.recommended,

  // 3. Main Configuration
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    // Register the plugins
    plugins: {
      'simple-import-sort': simpleImportSort,
      'unused-imports': unusedImports,
    },
    rules: {
      // --- IMPORT SORTING ---
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',

      // --- UNUSED IMPORTS & VARIABLES ---
      'no-unused-vars': 'off', // Must be off for unused-imports plugin to work
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': [
        'warn',
        {
          vars: 'all',
          varsIgnorePattern: '^_',
          args: 'after-used',
          argsIgnorePattern: '^_',
        },
      ],

      // --- GENERAL QUALITY ---
      'no-console': 'off',
      'prefer-const': 'error',
      eqeqeq: ['error', 'always'],
    },
  },

  // 4. Prettier (Must be last to override formatting rules)
  eslintConfigPrettier,
];
