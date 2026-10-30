import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: {
    '@erp/contracts/reconcile': fileURLToPath(new URL('./packages/contracts/src/reconcile.ts', import.meta.url)),
    '@erp/contracts/codec': fileURLToPath(new URL('./packages/contracts/src/codec.ts', import.meta.url)),
    '@erp/domain': fileURLToPath(new URL('./packages/domain/src/index.ts', import.meta.url)),
    '@erp/application': fileURLToPath(new URL('./packages/application/src/index.ts', import.meta.url)),
    '@erp/contracts': fileURLToPath(new URL('./packages/contracts/src/index.ts', import.meta.url)),
  } },
  test: { include: ['packages/**/*.test.ts', 'apps/desktop/test/**/*.test.ts', 'apps/api/test/**/*.test.ts', 'apps/web/test/**/*.test.ts'], environment: 'node', testTimeout: 30000, fileParallelism: false },
});
