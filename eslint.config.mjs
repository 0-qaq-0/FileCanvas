import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules/', 'test-results/', 'dist/', 'release/', 'source-zip/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      // Data read from JSON files and the IPC boundary is validated by hand, then typed.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      // `set.has(x) ? set.delete(x) : set.add(x)` reads well and is used throughout.
      '@typescript-eslint/no-unused-expressions': [
        'error',
        { allowTernary: true, allowShortCircuit: true },
      ],
      // `catch {}` is used on purpose where a failure changes nothing (logging, cleanup, probes).
      'no-empty': ['error', { allowEmptyCatch: true }],
      // File names are checked against control characters on purpose.
      'no-control-regex': 'off',
    },
  },
  {
    files: ['app/src/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      // Reported, not enforced: many effects run on purpose for one field or only once, and were
      // reviewed. Read new warnings: a missing dependency can be a stale value.
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    files: ['tests/**/*.{mjs,cjs}', 'scripts/**/*.mjs'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
);
