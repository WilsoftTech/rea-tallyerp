import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: {
    '@erp/contracts/codec': fileURLToPath(new URL('../../packages/contracts/src/codec.ts', import.meta.url)),
    '@erp/domain': fileURLToPath(new URL('../../packages/domain/src/index.ts', import.meta.url)),
    '@erp/application': fileURLToPath(new URL('../../packages/application/src/index.ts', import.meta.url)),
  } },
  build: { target: 'es2022' },
  clearScreen: false,
});
