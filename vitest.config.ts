import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@erp/domain': fileURLToPath(new URL('./packages/domain/src/index.ts', import.meta.url)) } },
  test: { include: ['packages/**/*.test.ts'], environment: 'node' },
});
