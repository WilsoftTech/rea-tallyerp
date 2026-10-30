import { readFile } from 'node:fs/promises';
import { createServer as httpsServer } from 'node:https';
import { AccountingError, ensure } from '@erp/domain';
import { assertRuntime, database } from './db.js';
import { createApi, handler } from './http.js';

async function main() {
  const connection = process.env['DATABASE_URL']; const signingFile = process.env['SIGNING_KEY_FILE'];
  const bootstrap = process.env['BOOTSTRAP_TOKEN'];
  ensure(connection && signingFile && bootstrap, 'CONFIGURATION_REQUIRED', 'Database, signing key and bootstrap authorization must be configured.');
  const db = database(connection); await assertRuntime(db);
  const options = { db, signingKey: await readFile(signingFile, 'utf8'), bootstrapToken: bootstrap,
    grantSeconds: Number(process.env['OFFLINE_GRANT_SECONDS'] ?? '86400') };
  const host = process.env['HOST'] ?? '127.0.0.1'; const port = Number(process.env['PORT'] ?? '4318');
  const cert = process.env['TLS_CERT_FILE']; const key = process.env['TLS_KEY_FILE'];
  const tls = Boolean(cert && key);
  ensure(tls || ['127.0.0.1', '::1', 'localhost'].includes(host), 'INSECURE_BIND', 'Use TLS for a public listener or bind behind a loopback TLS proxy.');
  const server = tls ? httpsServer({ cert: await readFile(cert!), key: await readFile(key!) }, handler(options)) : createApi(options);
  server.requestTimeout = 20000; server.headersTimeout = 10000; server.maxConnections = 64;
  server.listen(port, host, () => { console.log('Accounting API listening on ' + host + ':' + port + '; protocol 1.'); });
  const close = () => { server.close(() => { void db.$disconnect(); }); };
  process.on('SIGINT', close); process.on('SIGTERM', close);
}
void main().catch((error: unknown) => { console.error(error instanceof AccountingError ? error.code + ': ' + error.message : 'API_STARTUP_FAILED'); process.exitCode = 1; });
