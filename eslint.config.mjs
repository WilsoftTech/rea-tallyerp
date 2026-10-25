import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default [
  { ignores: ['**/dist/**', 'node_modules/**', '.cache/**', 'local-data/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['packages/**/*.ts'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-restricted-imports': ['error', { patterns: ['node:*', 'react', 'next', '@tauri-apps/*', '@prisma/*'] }],
    },
  },
];
