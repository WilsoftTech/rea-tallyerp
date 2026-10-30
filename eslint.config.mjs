import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default [
  { ignores: ['**/dist/**', '**/.next/**', '**/target/**', '**/gen/**', '**/generated/**', 'node_modules/**', '.cache/**', 'local-data/**', 'apps/web/public/sw.js', 'apps/web/next-env.d.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['apps/desktop/src/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-restricted-imports': ['error', { patterns: ['node:*', 'next', '@prisma/*'] }],
    },
  },
  {
    files: ['packages/domain/**/*.ts', 'packages/application/**/*.ts', 'packages/contracts/**/*.ts'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-restricted-imports': ['error', { patterns: ['node:*', 'react', 'next', '@tauri-apps/*', '@prisma/*'] }],
    },
  },
  {
    files: ['packages/workspace/**/*.{ts,tsx}'],
    rules: { '@typescript-eslint/consistent-type-imports': 'error', 'no-restricted-imports': ['error', { patterns: ['node:*', 'next', '@tauri-apps/*', '@prisma/*'] }] },
  },
];
