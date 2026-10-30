import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const engine = resolve(root, '.cache/prisma/schema-engine.exe');
const environment = { ...process.env };
if (existsSync(engine)) environment.PRISMA_SCHEMA_ENGINE_BINARY = engine;
const child = spawn(process.execPath, [resolve(root, 'node_modules/prisma/build/index.js'), ...process.argv.slice(2)],
  { cwd: resolve(root, 'apps/api'), env: environment, windowsHide: true, stdio: 'inherit' });
child.on('error', () => { console.error('Prisma could not start.'); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
