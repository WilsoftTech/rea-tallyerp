import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const localCargo = resolve(root, '.cache/cargo');
const localRust = resolve(root, '.cache/rustup');
const environment = { ...process.env };
if (existsSync(localCargo) && existsSync(localRust)) {
  environment.CARGO_HOME = localCargo;
  environment.RUSTUP_HOME = localRust;
  environment.PATH = resolve(localCargo, 'bin') + ';' + process.env.PATH;
}
const cargo = existsSync(resolve(localCargo, 'bin/cargo.exe')) ? resolve(localCargo, 'bin/cargo.exe') : 'cargo';
const manifest = resolve(root, 'apps/desktop/src-tauri/Cargo.toml');
const mode = process.argv[2];
let binary = cargo;
let args;
let cwd = root;
switch (mode) {
  case 'harness': args = ['build', '--manifest-path', manifest, '--no-default-features', '--bin', 'storage-harness']; break;
  case 'test': args = ['test', '--manifest-path', manifest, '--no-default-features', '--lib']; break;
  case 'check': args = ['clippy', '--manifest-path', manifest, '--all-targets', '--', '-D', 'warnings']; break;
  case 'fmt': args = ['fmt', '--manifest-path', manifest, '--', '--check']; break;
  case 'format': args = ['fmt', '--manifest-path', manifest]; break;
  case 'tree': args = ['tree', '--locked', '--offline', '--manifest-path', manifest, '--features', 'custom-protocol', '--target', 'x86_64-pc-windows-msvc', '--edges', 'normal,build', '--prefix', 'none', '--format', '{p}']; break;
  case 'debug': args = ['build', '--manifest-path', manifest, '--features', 'custom-protocol', '--bin', 'erp-desktop']; break;
  case 'build':
  case 'dev':
    binary = process.execPath;
    args = [resolve(root, 'node_modules/@tauri-apps/cli/tauri.js'), mode === 'build' ? 'build' : 'dev', ...(mode === 'build' ? ['--no-bundle'] : [])];
    cwd = resolve(root, 'apps/desktop');
    break;
  default: throw new Error('Use native.mjs harness|test|check|fmt|debug|build|dev');
}
const child = spawn(binary, args, { cwd, env: environment, windowsHide: true, stdio: 'inherit' });
child.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
