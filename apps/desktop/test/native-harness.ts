import { afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { AccountingError } from '@erp/domain';
import type { Native } from '../src/store.js';
// Integration tests require the real Rust harness. Missing binaries fail, never skip silently.
const executable = resolve('apps/desktop/src-tauri/target/debug/storage-harness.exe');
const cleanup: (() => void)[] = [];
afterEach(() => { while (cleanup.length) cleanup.pop()!(); });
export function harness(path: string) {
  const process = spawn(executable, [path], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const pending: { resolve: (value: unknown) => void; reject: (error: Error) => void }[] = [];
  let exited = false;
  const output = createInterface({ input: process.stdout });
  output.on('line', (line) => {
    const request = pending.shift(); if (!request) return;
    const response = JSON.parse(line) as { error?: { code: string; message: string; field: string | null }; ok?: unknown };
    if (response.error) request.reject(new AccountingError(response.error.code, response.error.message, response.error.field));
    else request.resolve(response.ok);
  });
  process.stderr.on('data', () => { /* payloads and passwords are never printed */ });
  process.on('error', (e) => {exited = true; for (const p of pending.splice(0)) p.reject(e);});
  process.on('exit', () => {exited = true; for (const p of pending.splice(0)) p.reject(new Error('Harness exited.'));});
  cleanup.push(() => { if (!exited) process.kill(); output.close(); });
  let token = '';
  const native: Native = <T>(operation: string, payload: Record<string, unknown> = {}): Promise<T> => {
    if (exited) return Promise.reject(new Error('Native harness is unavailable.'));
    return new Promise<T>((resolveResult, reject) => {
      pending.push({ resolve: (value) => resolveResult(value as T), reject });
      process.stdin.write(JSON.stringify({ operation, payload: { ...payload, token } }) + '\n');
    });
  };
  return { native, setToken: (value: string) => { token = value; }, close: async () => {
    if (exited) return;
    const exit = new Promise<void>((resolveExit) => process.once('exit', () => resolveExit()));
    process.kill(); await exit;
  } };
}

