import js from '@eslint/js';
import globals from 'globals';
import importNewlines from 'eslint-plugin-import-newlines';

/**
 * The rules this package was written under, carried over from the UI Kit
 * monorepo it was split out of.
 *
 * One difference: there, a root config applied browser globals to every package
 * and a later block added node globals back for `packages/astro-twig/**`. Both
 * halves of this package run in Node — the integration is a build-time plugin
 * and the tests spawn Astro — so there is one block and its globals are node's.
 */
export default [
  {
    ignores: [
      '**/node_modules/**',
      // Astro's own output directory. Ignored by git already, but a build run
      // inside a test fixture or the example leaves one behind.
      '**/.astro/**',
      '**/dist/**',
      // tests/hmr.test.mjs mkdtemps a dev-server root in here.
      '.hmr-*/**',
    ],
  },

  js.configs.recommended,

  {
    plugins: {
      'import-newlines': importNewlines,
    },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'func-names': 'off',
      'guard-for-in': 'off',
      'max-len': ['error', { code: 10000, comments: 80 }],
      'no-continue': 'off',
      'no-nested-ternary': 'off',
      'no-new': 'off',
      'no-param-reassign': 'off',
      'no-plusplus': 'off',
      'no-restricted-syntax': 'off',
      'object-curly-newline': ['error', { ImportDeclaration: 'never' }],
      quotes: ['error', 'single', { avoidEscape: true, allowTemplateLiterals: true }],
      strict: 'off',
      'import-newlines/enforce': ['error', { items: 100, forceSingleLine: true, 'max-len': 10000 }],
      'no-useless-assignment': 'off',
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
      'no-bitwise': 'error',
      // Off, as it was in the monorepo: the integration reports through Astro's
      // logger, and the tests print what a failed build said.
      'no-console': 'off',
      'no-use-before-define': 'error',
      'no-underscore-dangle': 'error',
      'no-caller': 'error',
      'no-alert': 'error',
      'prefer-template': 'error',
      'new-cap': ['error', { capIsNew: false }],
    },
  },
];
