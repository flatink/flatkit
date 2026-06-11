import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import globals from 'globals'

// Lint the whole workspace (packages/*) from the root. flatkit is a pure TypeScript
// library — no React, no editor-specific plugins.
export default tseslint.config(
  { ignores: ['**/dist/**', '**/coverage/**', '**/*.config.{js,ts,mjs,cjs}'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  // The CLI and build scripts run under Node (process, fs, …).
  {
    files: ['packages/compiler/bin/**/*.mjs', 'packages/compiler/src/cli/**/*.ts', 'scripts/**/*.mjs'],
    languageOptions: { globals: { ...globals.node } },
  },
)
