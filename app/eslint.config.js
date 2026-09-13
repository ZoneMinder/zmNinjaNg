import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores([
    'dist',
    'android',
    'ios',
    'coverage',
    'node_modules',
  ]),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
      jsxA11y.flatConfigs.recommended,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // C2 by machine: the count of over-long files is held by the lint
      // ratchet (.lint-baseline.json), so it can fall but not grow. The two
      // files below are where the Constants contract and the ZoneMinder
      // schemas funnel values by design, and are exempt in the next block.
      'max-lines': ['error', { max: 400, skipBlankLines: true, skipComments: true }],
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.name='Capacitor'][property.name='isNativePlatform']",
          message: 'Use Platform.isNative from lib/platform.ts instead of Capacitor.isNativePlatform() directly.',
        },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    files: ['src/lib/platform.ts', 'src/lib/__tests__/secureStorage.test.ts'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
  {
    files: ['src/lib/zmninja-ng-constants.ts', 'src/api/types.ts', '**/*.test.{ts,tsx}', 'src/tests/**'],
    rules: {
      'max-lines': 'off',
    },
  },
])
