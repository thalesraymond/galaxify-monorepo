import js from '@eslint/js'
import vitestPlugin from '@vitest/eslint-plugin'
import prettier from 'eslint-config-prettier'
import boundaries from 'eslint-plugin-boundaries'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import reactHooks from 'eslint-plugin-react-hooks'
import testingLibrary from 'eslint-plugin-testing-library'
import globals from 'globals'
import tseslint from 'typescript-eslint'

import { boundaryRuleOptions, boundariesPluginSettings } from './eslint.boundaries.js'

/** Global-store libraries that would duplicate TanStack Query server state. */
const forbiddenServerStateLibraries = [
  'zustand',
  'redux',
  '@reduxjs/toolkit',
  'jotai',
  'recoil',
  'mobx',
]

const forbiddenServerStateMessage =
  'Server state is owned by TanStack Query. Do not copy it into React Context or a global store (docs/specs/web-frontend.md §3.1).'

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'coverage/**',
      'node_modules/**',
      'playwright-report/**',
      'test-results/**',
      'blob-report/**',
      '.lighthouseci/**',
      'src/generated/**',
      'src/api/generated/**',
      'public/mockServiceWorker.js',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    languageOptions: {
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [tseslint.configs.strictTypeChecked],
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { boundaries },
    settings: {
      ...boundariesPluginSettings,
      'boundaries/root-path': import.meta.dirname,
    },
    rules: {
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      'boundaries/dependencies': ['error', boundaryRuleOptions],
      'no-restricted-imports': [
        'error',
        {
          paths: forbiddenServerStateLibraries.map((name) => ({
            name,
            message: forbiddenServerStateMessage,
          })),
          patterns: [
            {
              group: forbiddenServerStateLibraries.map((name) => `${name}/*`),
              message: forbiddenServerStateMessage,
            },
          ],
        },
      ],
    },
  },
  {
    ...reactHooks.configs.flat['recommended-latest'],
    files: ['**/*.{ts,tsx}'],
  },
  {
    ...jsxA11y.flatConfigs.recommended,
    files: ['**/*.{ts,tsx}'],
  },
  {
    files: ['src/**/*.test.{ts,tsx}', 'src/test/**/*.{ts,tsx}'],
    plugins: {
      vitest: vitestPlugin,
      'testing-library': testingLibrary,
    },
    rules: {
      ...vitestPlugin.configs.recommended.rules,
      ...testingLibrary.configs['flat/react'].rules,
    },
  },
  prettier,
)
