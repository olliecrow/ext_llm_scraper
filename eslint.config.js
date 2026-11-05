import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

const rules = {
  'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
  'no-console': ['warn', { allow: ['warn', 'error'] }],
  'prefer-const': 'error',
  'no-var': 'error',
  'arrow-body-style': ['error', 'as-needed'],
  'prefer-arrow-callback': 'error',
  'object-shorthand': 'error',
  'prefer-template': 'error',
  'no-param-reassign': 'error',
  'consistent-return': 'error',
  'no-shadow': 'error',
  eqeqeq: ['error', 'always'],
  curly: ['error', 'all'],
};

export default [
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**'],
  },
  js.configs.recommended,
  prettier,
  {
    files: ['src/**/*.js', 'tests/**/*.js', 'scripts/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.webextensions,
        chrome: 'readonly',
        Readability: 'readonly',
      },
    },
    rules,
  },
  {
    files: ['src/lib/readability.js'],
    linterOptions: {
      reportUnusedDisableDirectives: 'off',
    },
    rules: {
      'no-param-reassign': 'off',
      eqeqeq: 'off',
      'no-useless-escape': 'off',
      'no-var': 'off',
      'prefer-const': 'off',
      'no-constant-condition': 'off',
      'no-unused-vars': 'off',
      'no-useless-assignment': 'off',
    },
  },
  {
    files: ['scripts/**/*.js', 'tests/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    files: ['scripts/**/*.js'],
    rules: {
      'no-console': 'off',
    },
  },
];
