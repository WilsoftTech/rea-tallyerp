// Local development/test infrastructure only. Never provisions an external database.
import { randomBytes, generateKeyPairSync, createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
const { Client } = require('pg');
// pg_ctl can leave inherited pipe handles in its daemon on Windows.
// Observe the owned helper's exit; do not wait for the daemon's pipe EOF.
const run = (binary, args, options) => new Promise((resolveRun, reject) => {
  const child = spawn(binary, args, { ...options, stdio: 'ignore' });
  child.on('error', reject);
  child.on('exit', (code) => code === 0 ? resolveRun() : reject(new Error('PostgreSQL helper failed: ' + code)));
});
const root = resolve(import.meta.dirname, '..');
const directory = resolve(root, '.cache/cloud');
const binaries = resolve(root, '.cache/postgresql/bin');
const configPath = resolve(directory, 'development.json');
await mkdir(directory, { recursive: true });
let config;
try { config = JSON.parse(await readFile(configPath, 'utf8')); }
catch (e) {
  if (e.code !== 'ENOENT') throw e;
  const secret = () => randomBytes(32).toString('hex');
  config = { port: 55438, admin: secret(), runtime: secret(), bootstrap: secret(),
    cluster: resolve(directory, 'pgdata'), key: resolve(directory, 'signing.pem') };
  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n', { flag: 'wx' });
  const pair = generateKeyPairSync('ed25519');
  await writeFile(config.key, pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), { flag: 'wx' });
}
const mode = process.argv[2] ?? 'start';
const executable = (name) => resolve(binaries, name + '.exe');
const options = { windowsHide: true, maxBuffer: 1024 * 1024 };
if (mode === 'stop') {
  await run(executable('pg_ctl'), ['-D', config.cluster, '-m', 'fast', '-w', 'stop'], options);
  console.log('Local PostgreSQL stopped.'); process.exit(0);
}
try { await access(resolve(config.cluster, 'PG_VERSION')); }
catch (e) {
  if (e.code !== 'ENOENT') throw e;
  const passwordFile = resolve(directory, 'init-password.txt');
  await writeFile(passwordFile, config.admin);
  // No service registration, public listener or global configuration changes.
  try {
    await run(executable('initdb'), ['-D', config.cluster, '-U', 'erp_admin', '--auth=scram-sha-256',
      '--pwfile=' + passwordFile, '--encoding=UTF8', '--locale=C'], options);
  } finally {
    const { unlink } = await import('node:fs/promises'); await unlink(passwordFile);
  }
}
try { await run(executable('pg_ctl'), ['-D', config.cluster, 'status'], options); }
catch {
  await run(executable('pg_ctl'), ['-D', config.cluster, '-l', resolve(directory, 'postgres.log'),
    '-o', '-h 127.0.0.1 -p ' + config.port, '-w', 'start'], options);
}
const admin = new Client({ host: '127.0.0.1', port: config.port, user: 'erp_admin', password: config.admin, database: 'postgres', connectionTimeoutMillis: 5000 });
await admin.connect();
try {
  if (!(await admin.query("SELECT 1 FROM pg_roles WHERE rolname='erp_runtime'")).rowCount)
    await admin.query("CREATE ROLE erp_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD '" + config.runtime + "'");
  if (!(await admin.query("SELECT 1 FROM pg_database WHERE datname='erp_cloud'")).rowCount)
    await admin.query('CREATE DATABASE erp_cloud OWNER erp_admin');
} finally { await admin.end(); }
const database = new Client({ host: '127.0.0.1', port: config.port, user: 'erp_admin', password: config.admin, database: 'erp_cloud', connectionTimeoutMillis: 5000 });
await database.connect();
try {
  await database.query("CREATE TABLE IF NOT EXISTS engineering_migrations(id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now(), checksum text)");
  await database.query('ALTER TABLE engineering_migrations ADD COLUMN IF NOT EXISTS checksum text');
  const { readdir } = await import('node:fs/promises');
  const folder = resolve(root, 'apps/api/prisma/migrations');
  for (const name of (await readdir(folder)).sort()) {
    const sql = await readFile(resolve(folder, name, 'migration.sql'), 'utf8');
    const checksum = createHash('sha256').update(sql.replaceAll('\r\n', '\n')).digest('hex');
    const prior = await database.query('SELECT checksum FROM engineering_migrations WHERE id=$1', [name]);
    if (prior.rowCount) {
      // One-time baseline for this unreleased engineering cluster; subsequent edits fail closed.
      if (prior.rows[0].checksum === null) await database.query('UPDATE engineering_migrations SET checksum=$1 WHERE id=$2', [checksum, name]);
      else if (prior.rows[0].checksum !== checksum) throw new Error('Applied migration changed: ' + name + '; add a forward migration.');
      continue;
    }
    await database.query('BEGIN');
    try { await database.query(sql); await database.query('INSERT INTO engineering_migrations(id,checksum) VALUES($1,$2)', [name,checksum]); await database.query('COMMIT'); }
    catch (e) { await database.query('ROLLBACK'); throw e; }
  }
  await database.query('GRANT CONNECT ON DATABASE erp_cloud TO erp_runtime; GRANT USAGE ON SCHEMA public TO erp_runtime; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO erp_runtime; REVOKE ALL ON engineering_migrations FROM erp_runtime');
} finally { await database.end(); }
const url = 'postgresql://erp_runtime:' + config.runtime + '@127.0.0.1:' + config.port + '/erp_cloud';
await writeFile(resolve(directory, 'api.env'), 'DATABASE_URL=' + url + '\nSIGNING_KEY_FILE=' + config.key.replaceAll('\\', '/') +
  '\nBOOTSTRAP_TOKEN=' + config.bootstrap + '\nHOST=127.0.0.1\nPORT=4318\nALLOW_LOOPBACK_HTTP=true\nOFFLINE_GRANT_SECONDS=86400\n');
console.log('Local PostgreSQL ready at 127.0.0.1:' + config.port + '; credentials/signing key remain in ignored .cache/cloud. Runtime role cannot bypass RLS.');
