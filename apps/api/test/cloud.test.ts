import { afterAll, beforeAll, expect, test } from 'vitest';
import { randomBytes, generateKeyPairSync, createPublicKey, verify } from 'node:crypto';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { Client } from 'pg';
import type { AddressInfo } from 'node:net';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createApi } from '../src/http.js';
import { assertRuntime, database } from '../src/db.js';
import type { Tx } from '../src/db.js';
import { Auth } from '../src/auth.js';
import { configuration, journal, scope as source } from '../../../packages/domain/test/fixtures.js';
import { encode, json, parseBook, seed, remap } from '@erp/contracts';
import type { Outcome } from '@erp/contracts';
import { trialBalance } from '@erp/domain';
import { decode, operational } from '@erp/contracts/codec';
import { AccountingService } from '@erp/application';
import type { Principal } from '@erp/application';
import { DesktopBookStore } from '../../desktop/src/store.js';
import { harness } from '../../desktop/test/native-harness.js';

let admin: Client;
let db: ReturnType<typeof database>;
let server: ReturnType<typeof createApi>;
let base: string;
let token: string;
let tenant: string;
let userId: string;
let epoch: string;
let databaseName: string;
const bootstrap = randomBytes(32).toString('hex');
const password = 'Synthetic cloud password 2026';
const device = 'device-a';
const generation = 'generation-a';
const company = source.companyId;
const endpoint = () => '/v1/tenants/' + tenant + '/companies/' + company;
interface Reply extends Partial<Outcome> {
  error?: { code: string; field: string | null }; userId?: string; tenantId?: string; token?: string;
  id?: string;
  epoch?: string; book?: unknown; after?: number; hasMore?: boolean; outcomes?: Outcome[];
  payload?: string; signature?: string; publicKey?: string;
}
async function desktopFixture(companyId: string, origin = base) {
  const directory = await mkdtemp(resolve(tmpdir(), 'erp-cloud-synthetic-'));
  const path = resolve(directory, 'accounting.sqlite');
  const host = harness(path);
  const auth = await host.native<{ token: string; tenantId: string }>('setup', { password }); host.setToken(auth.token);
  const local = { tenantId: auth.tenantId, companyId };
  const config = configuration();
  const store = new DesktopBookStore(host.native);
  await store.register({ company: { ...config.company, ...local }, years: config.years.map((r) => ({ ...r, ...local })),
    periods: config.periods.map((r) => ({ ...r, ...local })), groups: config.groups.map((r) => ({ ...r, ...local })), ledgers: config.ledgers.map((r) => ({ ...r, ...local })) });
  const actor: Principal = { ...local, actorId: 'local-owner', permissions: ['read', 'post', 'reverse', 'draft', 'manage-chart', 'manage-periods', 'reopen-period'] };
  const service = new AccountingService(store, () => new Date().toISOString());
  const signed = await host.native<Record<string, unknown>>('cloud_login', { endpoint: origin, username: 'synthetic.owner', password });
  expect(Object.keys(signed).sort()).toEqual(['endpoint', 'tenants', 'userId']); // Actual native boundary returns no bearer/password.
  return { host, path, directory, local, store, actor, service };
}
async function request(path: string, method = 'GET', data?: unknown, bearer = token): Promise<{ status: number; body: Reply }> {
  const response = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(bearer ? { authorization: 'Bearer ' + bearer } : {}) },
    ...(data === undefined ? {} : { body: encode(data) }) });
  return { status: response.status, body: await response.json() as Reply };
}
function packet(commandId: string, id = commandId, amount = 1000n) {
  return { protocol: 1, deviceId: device, generation, epoch, dependencies: [],
    command: { kind: 'post', commandId, expectedChartVersion: 1, journal: journal({ id, lines: [
      { ledgerId: 'cash', side: 'debit', amount }, { ledgerId: 'equity', side: 'credit', amount },
    ] }) } };
}
async function snapshot() {
  const response = await request(endpoint() + '/snapshot');
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return parseBook(response.body.book);
}
async function ownerSql(sql: string, values: unknown[] = []) {
  const local = JSON.parse(await readFile('.cache/cloud/development.json', 'utf8')) as { port: number; admin: string };
  if (!/^erp_verify_[a-f0-9]{16}$/.test(databaseName)) throw new Error('Fixture database required.');
  const connection = new Client({ host: '127.0.0.1', port: local.port, user: 'erp_admin', password: local.admin, database: databaseName, connectionTimeoutMillis: 5000 });
  await connection.connect(); try {return await connection.query(sql, values);} finally {await connection.end();}
}
beforeAll(async () => {
  const local = JSON.parse(await readFile('.cache/cloud/development.json', 'utf8')) as { port: number; admin: string; runtime: string };
  const config = { host: '127.0.0.1', port: local.port, user: 'erp_admin', password: local.admin, connectionTimeoutMillis: 5000 };
  admin = new Client({ ...config, database: 'postgres' }); await admin.connect();
  databaseName = 'erp_verify_' + randomBytes(8).toString('hex');
  await admin.query('CREATE DATABASE ' + databaseName + ' OWNER erp_admin');
  const migration = new Client({ ...config, database: databaseName }); await migration.connect();
  try {
    for (const name of ['001_foundation', '002_security_audit', '003_resolution_links', '004_enrollment_cancellation']) await migration.query(
      await readFile(resolve('apps/api/prisma/migrations', name, 'migration.sql'), 'utf8'));
    await migration.query('GRANT CONNECT ON DATABASE ' + databaseName + ' TO erp_runtime; GRANT USAGE ON SCHEMA public TO erp_runtime; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO erp_runtime');
  } finally { await migration.end(); }
  db = database('postgresql://erp_runtime:' + local.runtime + '@127.0.0.1:' + local.port + '/' + databaseName);
  await assertRuntime(db);
  const pair = generateKeyPairSync('ed25519');
  server = createApi({ db, signingKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), bootstrapToken: bootstrap });
  await new Promise<void>((resolveReady) => server.listen(0, '127.0.0.1', resolveReady));
  base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  const first = await request('/v1/auth/bootstrap', 'POST', { token: bootstrap, username: 'synthetic.owner', password, tenantName: 'Synthetic Cloud Lab' }, '');
  expect(first.status, JSON.stringify(first.body)).toBe(201); tenant = first.body.tenantId as string; userId = first.body.userId as string;
  const login = await request('/v1/auth/login', 'POST', { username: 'synthetic.owner', password }, '');
  expect(login.status, JSON.stringify(login.body)).toBe(200); token = login.body.token as string;
  const imported = await request('/v1/tenants/' + tenant + '/companies', 'POST', {
    protocol: 1, enrollmentId: 'enrollment-a', deviceId: device, generation, sourceTenant: source.tenantId,
    sourceCompany: company, confirmed: true, book: json(seed(configuration())),
  });
  expect(imported.status, JSON.stringify(imported.body)).toBe(201); epoch = imported.body.epoch as string;
}, 30000);
afterAll(async () => {
  if (server) { server.closeAllConnections(); await new Promise<void>((done) => server.close(() => done())); }
  if (db) await db.$disconnect();
  if (admin) {
    // Only the random database created by this fixture may be dropped.
    if (/^erp_verify_[a-f0-9]{16}$/.test(databaseName)) await admin.query('DROP DATABASE ' + databaseName + ' WITH (FORCE)');
    await admin.end();
  }
});

test('native desktop enrolls a reviewed seed, posts offline, uploads exactly once and pulls a separate canonical mirror', async () => {
  const f = await desktopFixture('native-enroll');
  await f.service.post(f.actor, { kind: 'post', commandId: 'native-seed', expectedChartVersion: 1, journal: journal({ ...f.local, id: 'native-seed-j' }) });
  const original = await f.store.read(f.local);
  await f.host.native('cloud_enroll', { companyId: f.local.companyId, remoteTenant: tenant, confirmed: true });
  await f.service.post(f.actor, { kind: 'post', commandId: 'native-offline', expectedChartVersion: 1, journal: journal({ ...f.local, id: 'native-offline-j' }) });
  const queued = await f.host.native<{ commands: { commandId: string; state: string }[] }>('cloud_status', { companyId: f.local.companyId });
  expect(queued.commands.find((r) => r.commandId === 'native-offline')?.state).toBe('pending');
  await f.host.native('cloud_sync', { companyId: f.local.companyId }); await f.host.native('cloud_sync', { companyId: f.local.companyId });
  const status = await f.host.native<{ canonical: unknown; commands: { state: string }[]; cursor: number }>('cloud_status', { companyId: f.local.companyId });
  expect(status.commands.every((r) => r.state === 'accepted')).toBe(true); expect(status.cursor).toBe(2);
  const canonical = parseBook(status.canonical); expect(canonical.entries).toHaveLength(2);
  expect(canonical.entries[1]?.actorId).toBe(userId); expect((await f.store.read(f.local)).entries[0]).toEqual(original.entries[0]);
  expect(trialBalance(canonical.config, canonical.entries, '2026-12-31').debit).toBe(2000n);
});
test('two native devices share accepted reports while preserving separate histories and online-only master edits', async () => {
  const a = await desktopFixture('native-shared');
  await a.host.native('cloud_enroll', { companyId: a.local.companyId, remoteTenant: tenant, confirmed: true });
  const b = await desktopFixture('unrelated-local-only');
  const joined = await b.host.native<{ companyId: string }>('cloud_join', { remoteTenant: tenant, remoteCompany: a.local.companyId, confirmed: true });
  const scopeB = { ...b.local, companyId: joined.companyId }; const actorB = { ...b.actor, ...scopeB };
  await a.service.post(a.actor, { kind: 'post', commandId: 'shared-a', expectedChartVersion: 1, journal: journal({ ...a.local, id: 'shared-j-a' }) });
  await b.service.post(actorB, { kind: 'post', commandId: 'shared-b', expectedChartVersion: 1, journal: journal({ ...scopeB, id: 'shared-j-b' }) });
  await a.host.native('cloud_sync', { companyId: a.local.companyId }); await b.host.native('cloud_sync', { companyId: scopeB.companyId });
  await a.host.native('cloud_sync', { companyId: a.local.companyId });
  const status = await b.host.native<{ canonical: unknown; commands: [] }>('cloud_status', { companyId: scopeB.companyId });
  const local = await b.store.read(scopeB); expect(local.entries).toHaveLength(1);
  const view = operational(local, decode(encode(status.canonical)), status.commands);
  expect(view.entries).toHaveLength(2); expect(trialBalance(view.config, view.entries, '2026-12-31').debit).toBe(2000n);
  await expect(a.service.setPeriodStatus(a.actor, { kind: 'period-status', commandId: 'local-lock-denied', periodId: 'jan', expectedVersion: 1, status: 'locked', reason: 'Synthetic close' })).rejects.toMatchObject({ code: 'ONLINE_MASTER_REQUIRED' });
  await a.host.native('cloud_command', { companyId: a.local.companyId, command: { kind: 'period-status', commandId: 'shared-lock', periodId: 'jan', expectedVersion: 1, status: 'locked', reason: 'Synthetic close' } });
  await b.host.native('cloud_sync', { companyId: scopeB.companyId });
  expect((await b.store.read(scopeB)).config.periods[0]?.status).toBe('locked');
  expect((await b.store.read(b.local)).config.periods[0]?.status).toBe('open');
});
test('period conflict retains the rejected original, device-only compensation and one accepted replacement', async () => {
  const f = await desktopFixture('native-resolution');
  await f.service.post(f.actor, { kind: 'post', commandId: 'resolution-capital', expectedChartVersion: 1, journal: journal({ ...f.local, id: 'resolution-capital-j' }) });
  await f.host.native('cloud_enroll', { companyId: f.local.companyId, remoteTenant: tenant, confirmed: true });
  await f.service.post(f.actor, { kind: 'post', commandId: 'resolution-rejected', expectedChartVersion: 1, journal: journal({ ...f.local, id: 'resolution-expense-j', lines: [
    { ledgerId: 'expense', side: 'debit', amount: 200n }, { ledgerId: 'cash', side: 'credit', amount: 200n },
  ] }) });
  // Another authorized online client closes January while this device has pending work.
  await f.host.native('cloud_command', { companyId: f.local.companyId, command: { kind: 'period-status', commandId: 'resolution-lock', periodId: 'jan', expectedVersion: 1, status: 'locked', reason: 'Synthetic month close' } });
  await f.host.native('cloud_sync', { companyId: f.local.companyId });
  const conflict = await f.host.native<{ commands: { commandId: string; state: string; code: string }[] }>('cloud_status', { companyId: f.local.companyId });
  expect(conflict.commands.find((c) => c.commandId === 'resolution-rejected')).toMatchObject({ state: 'conflict', code: 'PERIOD_LOCKED' });
  const compensate = new AccountingService(new DesktopBookStore(f.host.native, { resolutionMode: 'compensate', originalCommand: 'resolution-rejected' }), () => new Date().toISOString());
  await compensate.reverse(f.actor, { kind: 'reverse', commandId: 'resolution-compensate', originalId: 'resolution-expense-j', expectedChartVersion: 1,
    journal: { ...f.local, id: 'resolution-compensate-j', date: '2026-02-02', periodId: 'feb', expectedPeriodVersion: 1, narration: 'Resolve rejected January expense without erasing source evidence' } });
  const replacement = new AccountingService(new DesktopBookStore(f.host.native, { resolutionMode: 'replace', originalCommand: 'resolution-rejected' }), () => new Date().toISOString());
  await replacement.post(f.actor, { kind: 'post', commandId: 'resolution-replacement', expectedChartVersion: 1, journal: journal({ ...f.local, id: 'resolution-replacement-j', date: '2026-02-02', periodId: 'feb', lines: [
    { ledgerId: 'expense', side: 'debit', amount: 200n }, { ledgerId: 'cash', side: 'credit', amount: 200n },
  ] }) });
  await f.host.native('cloud_sync', { companyId: f.local.companyId });
  const state = await f.store.read(f.local);
  const status = await f.host.native<{ canonical: unknown; commands: { commandId: string; state: string; localOnly: boolean }[] }>('cloud_status', { companyId: f.local.companyId });
  const accepted = parseBook(status.canonical); expect(state.entries).toHaveLength(4); expect(accepted.entries).toHaveLength(2);
  expect(status.commands.find((c) => c.commandId === 'resolution-compensate')?.localOnly).toBe(true);
  expect(status.commands.find((c) => c.commandId === 'resolution-replacement')?.state).toBe('accepted');
  const localCash = trialBalance(state.config, state.entries, '2026-12-31').rows.find((r) => r.ledgerId === 'cash');
  const cloudCash = trialBalance(accepted.config, accepted.entries, '2026-12-31').rows.find((r) => r.ledgerId === 'cash');
  expect(localCash?.debit).toBe(800n); expect(cloudCash?.debit).toBe(800n);
});
test('restored synchronized backup blocks posting until explicit receipt and generation recovery', async () => {
  const f = await desktopFixture('native-recovery');
  await f.host.native('cloud_enroll', { companyId: f.local.companyId, remoteTenant: tenant, confirmed: true });
  const path = resolve(f.directory, 'synthetic.erpbackup'); const passphrase = 'Synthetic backup passphrase 2026';
  await f.host.native('backup_file', { path, passphrase });
  await f.service.post(f.actor, { kind: 'post', commandId: 'recovery-after-backup', expectedChartVersion: 1, journal: journal({ ...f.local, id: 'recovery-after-j' }) });
  await f.host.native('cloud_sync', { companyId: f.local.companyId });
  await f.host.native('restore_file', { path, passphrase });
  const unlocked = await f.host.native<{ token: string }>('unlock', { password }); f.host.setToken(unlocked.token);
  await expect(f.service.post(f.actor, { kind: 'post', commandId: 'restore-must-block', expectedChartVersion: 1, journal: journal({ ...f.local, id: 'restore-must-block-j' }) })).rejects.toMatchObject({ code: 'SYNC_REVIEW_REQUIRED' });
  await f.host.native('cloud_login', { endpoint: base, username: 'synthetic.owner', password });
  await f.host.native('cloud_recover', { companyId: f.local.companyId, confirmed: true });
  const status = await f.host.native<{ canonical: unknown; paused: string | null }>('cloud_status', { companyId: f.local.companyId });
  expect(status.paused).toBeNull(); expect(parseBook(status.canonical).entries).toHaveLength(1);
  expect((await f.store.read(f.local)).entries).toHaveLength(0);
  await f.service.post(f.actor, { kind: 'post', commandId: 'recovery-new', expectedChartVersion: 1, journal: journal({ ...f.local, id: 'recovery-new-j' }) });
  await f.host.native('cloud_sync', { companyId: f.local.companyId });
  expect(parseBook((await f.host.native<{ canonical: unknown }>('cloud_status', { companyId: f.local.companyId })).canonical).entries).toHaveLength(2);
});
test('a lost native POST acknowledgment is recovered from the change feed without a replacement financial ID', async () => {
  let drop = true;
  const proxy = createServer((incoming, outgoing) => { void (async () => {
    const chunks: Buffer[] = []; for await (const chunk of incoming) chunks.push(Buffer.from(chunk as Uint8Array));
    const response = await fetch(base + incoming.url, { method: incoming.method ?? 'GET', headers: { 'content-type': 'application/json', authorization: incoming.headers.authorization ?? '' },
      ...(['GET', 'HEAD'].includes(incoming.method ?? 'GET') ? {} : { body: Buffer.concat(chunks) }) });
    const bytes = await response.text();
    if (incoming.url?.endsWith('/commands') && drop) {drop = false; outgoing.destroy(); return;}
    outgoing.writeHead(response.status, { 'content-type': 'application/json' }); outgoing.end(bytes);
  })().catch(() => outgoing.destroy()); });
  await new Promise<void>((ready) => proxy.listen(0, '127.0.0.1', ready));
  try {
    const origin = 'http://127.0.0.1:' + (proxy.address() as AddressInfo).port;
    const f = await desktopFixture('native-lost-ack', origin);
    await f.host.native('cloud_enroll', { companyId: f.local.companyId, remoteTenant: tenant, confirmed: true });
    await f.service.post(f.actor, { kind: 'post', commandId: 'lost-ack-original-id', expectedChartVersion: 1, journal: journal({ ...f.local, id: 'lost-ack-j' }) });
    await expect(f.host.native('cloud_sync', { companyId: f.local.companyId })).rejects.toMatchObject({ code: 'NETWORK_UNAVAILABLE' });
    const pending = await f.host.native<{ commands: { state: string }[] }>('cloud_status', { companyId: f.local.companyId });
    expect(pending.commands[0]?.state).toBe('pending');
    await f.host.close(); const reopened = harness(f.path);
    const unlocked = await reopened.native<{ token: string }>('unlock', { password }); reopened.setToken(unlocked.token);
    await reopened.native('cloud_login', { endpoint: origin, username: 'synthetic.owner', password });
    await reopened.native('cloud_sync', { companyId: f.local.companyId });
    const status = await reopened.native<{ canonical: unknown; commands: { state: string }[] }>('cloud_status', { companyId: f.local.companyId });
    expect(status.commands[0]?.state).toBe('accepted'); expect(parseBook(status.canonical).entries).toHaveLength(1);
    expect((await new DesktopBookStore(reopened.native).read(f.local)).receipts[0]?.commandId).toBe('lost-ack-original-id');
  } finally {proxy.closeAllConnections(); await new Promise<void>((done) => proxy.close(() => done()));}
});
test('native role downgrade renews read-only authority and blocks new local financial writes', async () => {
  const a = await desktopFixture('native-role'); await a.host.native('cloud_enroll', { companyId: a.local.companyId, remoteTenant: tenant, confirmed: true });
  const created = await request('/v1/tenants/' + tenant + '/members', 'POST', { username: 'synthetic.accountant', password, role: 'accountant', companies: [a.local.companyId], reason: 'Synthetic role fixture' });
  expect(created.status).toBe(201);
  const b = await desktopFixture('role-local-independent');
  await b.host.native('cloud_login', { endpoint: base, username: 'synthetic.accountant', password });
  const joined = await b.host.native<{ companyId: string }>('cloud_join', { remoteTenant: tenant, remoteCompany: a.local.companyId, confirmed: true });
  const local = { ...b.local, companyId: joined.companyId }; const actor = { ...b.actor, ...local };
  await b.service.post(actor, { kind: 'post', commandId: 'role-before', expectedChartVersion: 1, journal: journal({ ...local, id: 'role-before-j' }) });
  const changed = await request('/v1/tenants/' + tenant + '/members/' + created.body.id, 'PUT', { role: 'viewer', disabled: false, expectedVersion: 1, companies: [a.local.companyId], reason: 'Synthetic permission withdrawal' });
  expect(changed.status).toBe(200);
  await b.host.native('cloud_sync', { companyId: local.companyId });
  const status = await b.host.native<{ permissions: string[]; commands: { state: string; code: string }[] }>('cloud_status', { companyId: local.companyId });
  expect(status.permissions).toEqual(['read']); expect(status.commands[0]).toMatchObject({ state: 'rejected', code: 'FORBIDDEN' });
  await expect(b.service.post(actor, { kind: 'post', commandId: 'role-after', expectedChartVersion: 1, journal: journal({ ...local, id: 'role-after-j' }) })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await b.service.post(b.actor, { kind: 'post', commandId: 'independent-still-works', expectedChartVersion: 1, journal: journal({ ...b.local, id: 'independent-j' }) });
});
test('native rejection pauses offline posting when revocation races after grant renewal', async () => {
  let revoke = true;
  const proxy = createServer((incoming, outgoing) => { void (async () => {
    const chunks: Buffer[] = []; for await (const chunk of incoming) chunks.push(Buffer.from(chunk as Uint8Array));
    if (incoming.url?.endsWith('/commands') && revoke) {
      revoke = false;
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { deviceId: string };
      const revoked = await request('/v1/tenants/' + tenant + '/companies/native-revocation-race/revoke-device', 'POST', {deviceId:body.deviceId,reason:'Synthetic after-renewal race'});
      expect(revoked.status).toBe(200);
    }
    const response = await fetch(base + incoming.url, {method:incoming.method ?? 'GET',headers:{'content-type':'application/json',authorization:incoming.headers.authorization ?? ''},...(['GET','HEAD'].includes(incoming.method ?? 'GET')?{}:{body:Buffer.concat(chunks)})});
    outgoing.writeHead(response.status,{'content-type':'application/json'});outgoing.end(await response.text());
  })().catch(()=>outgoing.destroy());});
  await new Promise<void>(ready=>proxy.listen(0,'127.0.0.1',ready));
  try {
    const f=await desktopFixture('native-revocation-race','http://127.0.0.1:'+(proxy.address() as AddressInfo).port);
    await f.host.native('cloud_enroll',{companyId:f.local.companyId,remoteTenant:tenant,confirmed:true});
    await f.service.post(f.actor,{kind:'post',commandId:'revocation-raced',expectedChartVersion:1,journal:journal({...f.local,id:'revocation-raced-j'})});
    await expect(f.host.native('cloud_sync',{companyId:f.local.companyId})).rejects.toMatchObject({code:'SYNC_REVIEW_REQUIRED'});
    const status=await f.host.native<{paused:string;commands:{state:string;code:string}[]}>('cloud_status',{companyId:f.local.companyId});
    expect(status.paused).toBe('device-revoked');expect(status.commands[0]).toMatchObject({state:'rejected',code:'DEVICE_REVOKED'});
    await expect(f.service.post(f.actor,{kind:'post',commandId:'after-race',expectedChartVersion:1,journal:journal({...f.local,id:'after-race-j'})})).rejects.toMatchObject({code:'SYNC_REVIEW_REQUIRED'});
  } finally {proxy.closeAllConnections();await new Promise<void>(done=>proxy.close(()=>done()));}
});
test('server epoch change pauses delivery until reviewed recovery; a missing accepted history cannot be overwritten', async () => {
  const f = await desktopFixture('native-epoch'); await f.host.native('cloud_enroll', { companyId: f.local.companyId, remoteTenant: tenant, confirmed: true });
  await ownerSql('UPDATE cloud_books SET epoch=$1 WHERE tenant_id=$2 AND company_id=$3', ['synthetic-rotated-epoch', tenant, f.local.companyId]);
  await expect(f.host.native('cloud_sync', { companyId: f.local.companyId })).rejects.toMatchObject({ code: 'GENERATION_CONFLICT' });
  await expect(f.service.post(f.actor, { kind: 'post', commandId: 'epoch-blocked', expectedChartVersion: 1, journal: journal({ ...f.local }) })).rejects.toMatchObject({ code: 'SYNC_REVIEW_REQUIRED' });
  await f.host.native('cloud_recover', { companyId: f.local.companyId, confirmed: true });
  const emptySnapshot = await f.store.read(f.local);
  await f.service.post(f.actor, { kind: 'post', commandId: 'epoch-accepted', expectedChartVersion: 1, journal: journal({ ...f.local, id: 'epoch-accepted-j' }) });
  await f.host.native('cloud_sync', { companyId: f.local.companyId });
  // Controlled synthetic disaster fixture: snapshot rollback with a new epoch; never touches owner data.
  await ownerSql('UPDATE cloud_books SET state=$1,epoch=$2 WHERE tenant_id=$3 AND company_id=$4', [encode(remap(emptySnapshot, f.local, { tenantId: tenant, companyId: f.local.companyId })), 'synthetic-lost-history', tenant, f.local.companyId]);
  await expect(f.host.native('cloud_recover', { companyId: f.local.companyId, confirmed: true })).rejects.toMatchObject({ code: 'CANONICAL_HISTORY_CONFLICT' });
  expect((await f.store.read(f.local)).entries).toHaveLength(1);
});
test('real Windows WebView2 exercises native login, reviewed enrollment, delivery states and accepted reporting', async () => {
  const { stdout } = await promisify(execFile)(process.execPath, ['tools/desktop-e2e.mjs'], { windowsHide: true, timeout: 120000,
    env: { ...process.env, ERP_CLOUD_E2E: base, ERP_CLOUD_E2E_USER: 'synthetic.owner', ERP_CLOUD_E2E_PASSWORD: password } });
  const report = JSON.parse(stdout) as { passed: boolean; checks: string[] };
  expect(report.passed).toBe(true); expect(report.checks).toHaveLength(8);
}, 130000);
test('an enrollment collision stays local and cancellation prevents delayed imports while releasing local master edits', async () => {
  const f = await desktopFixture(company);
  await expect(f.host.native('cloud_enroll', { companyId: company, remoteTenant: tenant, confirmed: true })).rejects.toMatchObject({ code: 'COMPANY_ALREADY_EXISTS' });
  const pending = await f.host.native<{ enrolled: boolean; pendingEnrollment: { id: string; book: unknown } }>('cloud_status', { companyId: company });
  expect(pending.enrolled).toBe(false); expect(pending.pendingEnrollment.id).toBeTruthy();
  const initial = await f.store.read(f.local);
  await expect(f.service.replaceChart(f.actor, { kind: 'replace-chart', commandId: 'pending-master-denied', expectedChartVersion: 1, groups: initial.config.groups, ledgers: initial.config.ledgers.map((r) => r.id === 'cash' ? { ...r, name: 'Reviewed cash' } : r) })).rejects.toMatchObject({ code: 'ENROLLMENT_PENDING' });
  await f.host.native('cloud_cancel_enrollment', { companyId: company, confirmed: true, reason: 'Keep local company independent; join the existing cloud company separately' });
  const delayed = await request('/v1/tenants/' + tenant + '/companies', 'POST', { protocol: 1, enrollmentId: pending.pendingEnrollment.id, deviceId: 'delayed-device', generation: 'delayed-generation', sourceTenant: f.local.tenantId, sourceCompany: company, confirmed: true, book: pending.pendingEnrollment.book });
  expect(delayed.body.error?.code).toBe('ENROLLMENT_CANCELLED');
  const state = await f.store.read(f.local);
  await f.service.replaceChart(f.actor, { kind: 'replace-chart', commandId: 'cancelled-master-allowed', expectedChartVersion: 1, groups: state.config.groups,
    ledgers: state.config.ledgers.map((r) => r.id === 'cash' ? { ...r, name: 'Independent cash' } : r) });
  expect((await f.store.read(f.local)).chartVersion).toBe(2);
});
test('a rejected reversal is compensated with a reasoned local contra journal and a linked replacement', async () => {
  const f = await desktopFixture('native-reversal-resolution');
  await f.service.post(f.actor, { kind: 'post', commandId: 'rr-capital', expectedChartVersion: 1, journal: journal({ ...f.local, id: 'rr-original' }) });
  await f.host.native('cloud_enroll', { companyId: f.local.companyId, remoteTenant: tenant, confirmed: true });
  await f.service.reverse(f.actor, { kind: 'reverse', commandId: 'rr-failed', expectedChartVersion: 1, originalId: 'rr-original', journal: { ...f.local, id: 'rr-reverse', date: '2026-01-16', periodId: 'jan', expectedPeriodVersion: 1, narration: 'Synthetic reversal submitted offline' } });
  await f.host.native('cloud_command', { companyId: f.local.companyId, command: { kind: 'period-status', commandId: 'rr-lock', periodId: 'jan', expectedVersion: 1, status: 'locked', reason: 'Synthetic close' } });
  await f.host.native('cloud_sync', { companyId: f.local.companyId });
  const compensate = new AccountingService(new DesktopBookStore(f.host.native, { resolutionMode: 'compensate', originalCommand: 'rr-failed' }), () => new Date().toISOString());
  await compensate.post(f.actor, { kind: 'post', commandId: 'rr-compensation', expectedChartVersion: 1, journal: journal({ ...f.local, id: 'rr-contra', date: '2026-02-02', periodId: 'feb', narration: 'Compensate rejected device reversal' }) });
  const replace = new AccountingService(new DesktopBookStore(f.host.native, { resolutionMode: 'replace', originalCommand: 'rr-failed' }), () => new Date().toISOString());
  await replace.post(f.actor, { kind: 'post', commandId: 'rr-replacement', expectedChartVersion: 1, journal: journal({ ...f.local, id: 'rr-replacement-j', date: '2026-02-02', periodId: 'feb', narration: 'Reviewed replacement of rejected reversal', lines: [
    { ledgerId: 'cash', side: 'credit', amount: 1000n }, { ledgerId: 'equity', side: 'debit', amount: 1000n },
  ] }) });
  await f.host.native('cloud_sync', { companyId: f.local.companyId });
  const local = await f.store.read(f.local); const remote = parseBook((await f.host.native<{ canonical: unknown }>('cloud_status', { companyId: f.local.companyId })).canonical);
  expect(local.entries).toHaveLength(4); expect(remote.entries).toHaveLength(2);
  expect(trialBalance(local.config, local.entries, '2026-12-31').debit).toBe(0n); expect(trialBalance(remote.config, remote.entries, '2026-12-31').debit).toBe(0n);
});
test('an existing rejected full reversal can be designated as device compensation without posting twice', async () => {
  const f = await desktopFixture('native-designated');
  await f.host.native('cloud_enroll', { companyId: f.local.companyId, remoteTenant: tenant, confirmed: true });
  await f.service.post(f.actor, { kind: 'post', commandId: 'designated-original', expectedChartVersion: 1, journal: journal({ ...f.local, id: 'designated-j' }) });
  await f.service.reverse(f.actor, { kind: 'reverse', commandId: 'designated-reverse', expectedChartVersion: 1, originalId: 'designated-j', journal: { ...f.local, id: 'designated-reverse-j', date: '2026-01-16', periodId: 'jan', expectedPeriodVersion: 1, narration: 'Offline full correction' } });
  await f.host.native('cloud_command', { companyId: f.local.companyId, command: { kind: 'period-status', commandId: 'designated-lock', periodId: 'jan', expectedVersion: 1, status: 'locked', reason: 'Synthetic close' } });
  await f.host.native('cloud_sync', { companyId: f.local.companyId });
  await f.host.native('cloud_designate_compensation', { companyId: f.local.companyId, originalCommand: 'designated-original', reversalCommand: 'designated-reverse', reason: 'Existing rejected reversal already offsets the device journal' });
  const status = await f.host.native<{ resolutions: unknown[]; commands: { commandId: string; localOnly: boolean }[] }>('cloud_status', { companyId: f.local.companyId });
  expect(status.resolutions).toHaveLength(1); expect(status.commands.find((c) => c.commandId === 'designated-reverse')?.localOnly).toBe(true);
  expect((await f.store.read(f.local)).entries).toHaveLength(2);
});
test('signed-64-bit maximum amounts persist exactly through native transport, Prisma and PostgreSQL with wider report sums', async () => {
  const f = await desktopFixture('native-cloud-wide'); await f.host.native('cloud_enroll', { companyId: f.local.companyId, remoteTenant: tenant, confirmed: true });
  const maximum = (1n << 63n) - 1n;
  await f.service.post(f.actor, { kind: 'post', commandId: 'cloud-wide', expectedChartVersion: 1, journal: journal({ ...f.local, id: 'cloud-wide-j', lines: [
    { ledgerId: 'cash', side: 'debit', amount: maximum }, { ledgerId: 'cash', side: 'debit', amount: maximum },
    { ledgerId: 'equity', side: 'credit', amount: maximum }, { ledgerId: 'equity', side: 'credit', amount: maximum },
  ] }) });
  await f.host.native('cloud_sync', { companyId: f.local.companyId });
  const cloud = parseBook((await f.host.native<{ canonical: unknown }>('cloud_status', { companyId: f.local.companyId })).canonical);
  expect(cloud.entries[0]?.lines[0]?.amount).toBe(maximum); expect(trialBalance(cloud.config, cloud.entries, '2026-12-31').debit).toBe(2n * maximum);
});
test('real runtime role has RLS without owner/bypass privileges, and absent context is default-deny', async () => {
  await assertRuntime(db);
  const rows = await db.$queryRawUnsafe<unknown[]>('SELECT * FROM cloud_books');
  expect(rows).toHaveLength(0);
  const policies = await db.$queryRawUnsafe<{ n: bigint }[]>("SELECT count(*) AS n FROM pg_class WHERE relname='cloud_books' AND relrowsecurity AND relforcerowsecurity");
  expect(policies[0]?.n).toBe(1n);
});
test('two independent HTTP requests race one command; altered retry cannot duplicate or change it', async () => {
  const responses = await Promise.all(Array.from({ length: 12 }, () => request(endpoint() + '/commands', 'POST', packet('race-1'))));
  expect(responses.every((r) => r.status === 200), JSON.stringify(responses)).toBe(true);
  expect(responses.every((r) => r.body.status === 'accepted')).toBe(true);
  const first = responses[0]!.body as Outcome;
  expect(responses.every((r) => r.body.cursor === first.cursor)).toBe(true);
  const changed = packet('race-1', 'race-1', 999n);
  expect((await request(endpoint() + '/commands', 'POST', changed)).body.error?.code).toBe('IDEMPOTENCY_CONFLICT');
  const state = await snapshot(); expect(state.entries.filter((e) => e.id === 'race-1')).toHaveLength(1);
  expect(trialBalance(state.config, state.entries, '2026-01-31').debit).toBe(1000n);
});
test('unbalanced command retains one stable rejection and no partial posting', async () => {
  const bad = packet('bad-balance');
  bad.command.journal = journal({ id: 'bad-balance', lines: [
    { ledgerId: 'cash', side: 'debit', amount: 200n }, { ledgerId: 'equity', side: 'credit', amount: 199n },
  ] });
  const first = await request(endpoint() + '/commands', 'POST', bad);
  expect(first.body.status).toBe('rejected'); expect(first.body.code).toBe('UNBALANCED_JOURNAL');
  expect((await request(endpoint() + '/commands', 'POST', bad)).body).toEqual(first.body);
  expect((await snapshot()).entries.some((e) => e.id === 'bad-balance')).toBe(false);
});
test('PostgreSQL guards reject inverted ranges, immutable edits and deferred unbalanced persistence', async () => {
  const context = async (tx: Tx) => {
    await tx.$executeRawUnsafe("SELECT set_config('app.user',$1,true),set_config('app.tenant',$2,true)", userId, tenant);
  };
  await expect(db.$transaction(async (tx) => { await context(tx); await tx.$executeRawUnsafe(
    "INSERT INTO cloud_periods VALUES($1,$2,'invalid-range','fy26','2026-02-28','2026-02-01','open',1)", tenant, company); })).rejects.toThrow();
  await expect(db.$transaction(async (tx) => { await context(tx); await tx.$executeRawUnsafe(
    "UPDATE cloud_journals SET body=body WHERE tenant_id=$1 AND company_id=$2 AND id='race-1'", tenant, company); })).rejects.toThrow();
  await expect(db.$transaction(async (tx) => { await context(tx); await tx.$executeRawUnsafe(
    "INSERT INTO cloud_journals VALUES($1,$2,'unbalanced-direct','jan','2026-01-15',1,'{}'::jsonb,false)", tenant, company);
    await tx.$executeRawUnsafe("INSERT INTO cloud_lines VALUES($1,$2,'unbalanced-direct',0,'cash','debit',100)", tenant, company);
    await tx.$executeRawUnsafe("UPDATE cloud_journals SET finalized=true WHERE tenant_id=$1 AND company_id=$2 AND id='unbalanced-direct'", tenant, company);
  })).rejects.toThrow();
});
test('a persistence failure rolls back journal, outcome and cursor together; retrying the same ID succeeds', async () => {
  const before = await request(endpoint() + '/snapshot');
  await ownerSql("CREATE FUNCTION fixture_feed_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.command_id='atomic-fault' THEN RAISE EXCEPTION 'synthetic storage failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fixture_feed_failure BEFORE INSERT ON cloud_changes FOR EACH ROW EXECUTE FUNCTION fixture_feed_failure()");
  try {
    expect((await request(endpoint() + '/commands', 'POST', packet('atomic-fault'))).status).toBe(500);
    expect((await request(endpoint() + '/snapshot')).body.cursor).toBe(before.body.cursor);
    expect((await snapshot()).entries.some((e) => e.id === 'atomic-fault')).toBe(false);
    const receipts = await request(endpoint() + '/receipts', 'POST', { ids: ['atomic-fault'] }); expect(receipts.body).toEqual([]);
  } finally {await ownerSql('DROP TRIGGER fixture_feed_failure ON cloud_changes; DROP FUNCTION fixture_feed_failure()');}
  expect((await request(endpoint() + '/commands', 'POST', packet('atomic-fault'))).body.status).toBe('accepted');
});
test('server revalidates period lock, reports conflict, and duplicate accepted receipt survives the lock', async () => {
  const lock = { protocol: 1, deviceId: device, generation, epoch, dependencies: [], command: {
    kind: 'period-status', commandId: 'lock-jan', periodId: 'jan', status: 'locked', expectedVersion: 1, reason: 'Synthetic close',
  } };
  expect((await request(endpoint() + '/commands', 'POST', lock)).body.status).toBe('accepted');
  const late = await request(endpoint() + '/commands', 'POST', packet('late-post'));
  expect(late.body.status).toBe('conflict'); expect(late.body.code).toBe('PERIOD_LOCKED');
  expect((await request(endpoint() + '/commands', 'POST', packet('race-1'))).body.status).toBe('accepted');
  const reopen = { ...lock, command: { ...lock.command, commandId: 'reopen-jan', status: 'open', expectedVersion: 2, reason: 'Synthetic reopening' } };
  expect((await request(endpoint() + '/commands', 'POST', reopen)).body.status).toBe('accepted');
});
test('incremental pull is gap-free and snapshots correspond exactly to returned cursors', async () => {
  let after = 0; let count = 0;
  for (;;) {
    const response = await request(endpoint() + '/changes?after=' + after + '&epoch=' + epoch + '&limit=2');
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.after).toBe(after);
    for (const row of response.body.outcomes ?? []) expect(row.cursor).toBe(++after);
    expect(response.body.cursor).toBe(after); parseBook(response.body.book); count++;
    if (!response.body.hasMore) break;
  }
  expect(count).toBeGreaterThan(1);
  const wrong = await request(endpoint() + '/changes?after=' + (after + 10) + '&epoch=' + epoch);
  expect(wrong.body.error?.code).toBe('CURSOR_AHEAD');
});
test('signed offline grant is limited to 24 hours, scope/device/generation and verified server signature', async () => {
  const response = await request(endpoint() + '/grant', 'POST', { deviceId: device, generation });
  expect(response.status).toBe(200);
  const grant = response.body as { payload: string; signature: string; publicKey: string };
  const data = Buffer.from(grant.payload, 'base64url'); const claims = JSON.parse(data.toString('utf8'));
  expect(claims.expiresAt - claims.issuedAt).toBe(86400); expect(claims.userId).toBe(userId);
  expect(claims.sourceTenant).toBe(source.tenantId); expect(claims.companyId).toBe(company);
  const key = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(grant.publicKey, 'base64url')]), type: 'spki', format: 'der' });
  expect(verify(null, data, key, Buffer.from(grant.signature, 'base64url'))).toBe(true);
  data[0] = data[0]! ^ 1; expect(verify(null, data, key, Buffer.from(grant.signature, 'base64url'))).toBe(false);
});
test('tenant and company assignment stop a real viewer from posting or reading unassigned books', async () => {
  const user = await request('/v1/tenants/' + tenant + '/members', 'POST', {
    username: 'synthetic.viewer', password, role: 'viewer', companies: [company], reason: 'Synthetic access test',
  });
  expect(user.status, JSON.stringify(user.body)).toBe(201);
  const login = await request('/v1/auth/login', 'POST', { username: 'synthetic.viewer', password }, '');
  const viewer = login.body.token as string;
  expect((await request('/v1/tenants/' + tenant + '/members', 'GET', undefined, viewer)).status).toBe(403);
  const members = await request('/v1/tenants/' + tenant + '/members');
  expect(members.status).toBe(200);
  expect(members.body).toEqual(expect.arrayContaining([expect.objectContaining({ id: user.body.id, username: 'synthetic.viewer', version: 1, role: 'viewer' })]));
  expect(encode(members.body)).not.toContain('password_hash'); expect(encode(members.body)).not.toContain('token_hash');
  expect((await request(endpoint() + '/snapshot', 'GET', undefined, viewer)).status).toBe(200);
  const foreign = await request('/v1/tenants/not-this-tenant/companies/' + company + '/snapshot', 'GET', undefined, viewer);
  expect(foreign.status).toBe(403);
  const denied = await request('/v1/tenants/' + tenant + '/members', 'POST', {
    username: 'synthetic.escalation', password, role: 'owner', companies: [company], reason: 'Forbidden promotion',
  }, viewer);
  expect(denied.status).toBe(403);
  const other = await request('/v1/tenants/' + tenant + '/companies', 'POST', {
    protocol: 1, enrollmentId: 'enroll-second', deviceId: 'second-device', generation: 'second-generation',
    sourceTenant: source.tenantId, sourceCompany: 'second-company', confirmed: true,
    book: json(seed({ ...configuration(), company: { ...configuration().company, companyId: 'second-company' },
      years: configuration().years.map((r) => ({ ...r, companyId: 'second-company' })), periods: configuration().periods.map((r) => ({ ...r, companyId: 'second-company' })),
      groups: configuration().groups.map((r) => ({ ...r, companyId: 'second-company' })), ledgers: configuration().ledgers.map((r) => ({ ...r, companyId: 'second-company' })) })),
  });
  expect(other.status, JSON.stringify(other.body)).toBe(201);
  expect((await request('/v1/tenants/' + tenant + '/companies/second-company/snapshot', 'GET', undefined, viewer)).status).toBe(403);
  const visible = await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SELECT set_config('app.user',$1,true),set_config('app.tenant',$2,true)", user.body.id, tenant);
    return tx.$queryRawUnsafe<{ company_id: string }[]>('SELECT company_id FROM cloud_books');
  });
  expect(visible.map((r) => r.company_id)).toEqual([company]);
  const foreignRows = await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SELECT set_config('app.user',$1,true),set_config('app.tenant','unassigned-tenant',true)", user.body.id);
    return tx.$queryRawUnsafe<unknown[]>('SELECT * FROM cloud_books');
  }); expect(foreignRows).toEqual([]);
});
test('protocol, scope and invalid financial-period input fail explicitly without a cloud company', async () => {
  expect((await request(endpoint() + '/commands', 'POST', { ...packet('protocol-bad'), protocol: 99 })).body.error?.code).toBe('UNSUPPORTED_PROTOCOL');
  const scoped = packet('scope-bad'); scoped.command.journal = journal({ tenantId: 'foreign-tenant' });
  const foreign = await request(endpoint() + '/commands', 'POST', scoped);
  expect(foreign.body.status).toBe('rejected'); expect(foreign.body.code).toBe('SCOPE_MISMATCH');
  const invalid = json(seed(configuration())) as { config: { periods: { end: string }[] } }; invalid.config.periods[0]!.end = '2025-01-01';
  const response = await request('/v1/tenants/' + tenant + '/companies', 'POST', {
    protocol: 1, enrollmentId: 'invalid-enrollment', deviceId: 'bad-device', generation: 'bad-generation',
    sourceTenant: source.tenantId, sourceCompany: company, confirmed: true, book: invalid,
  });
  expect(response.status).toBe(400); expect(response.body.error?.code).toBe('INVALID_PERIOD_RANGE');
  expect(response.body.error?.field).toBe('endDate');
});
test('new database role can authenticate through the real service without receiving table ownership', async () => {
  const actor = await new Auth(db, bootstrap).authenticate(token); expect(actor.userId).toBe(userId);
  await expect(new Auth(db, bootstrap).authenticate('forged-token')).rejects.toMatchObject({ code: 'AUTHENTICATION_FAILED' });
});
test('concurrent shared chart changes retain one winner and stale offline accounting conflicts explicitly', async () => {
  const config = configuration();
  const a = { protocol: 1, deviceId: device, generation, epoch, dependencies: [], command: {
    kind: 'replace-chart', commandId: 'chart-concurrent-a', expectedChartVersion: 1, groups: config.groups,
    ledgers: config.ledgers.map((l) => l.id === 'cash' ? { ...l, name: 'Synthetic Cash A' } : l),
  } };
  const b = { ...a, command: { ...a.command, commandId: 'chart-concurrent-b', ledgers: config.ledgers.map((l) => l.id === 'cash' ? { ...l, name: 'Synthetic Cash B' } : l) } };
  const results = await Promise.all([request(endpoint() + '/commands', 'POST', a), request(endpoint() + '/commands', 'POST', b)]);
  expect(results.map((r) => r.body.status).sort()).toEqual(['accepted', 'conflict']);
  expect(results.find((r) => r.body.status === 'conflict')?.body.code).toBe('VERSION_CONFLICT');
  const stale = packet('stale-chart'); stale.command.journal = { ...stale.command.journal, expectedPeriodVersion: 3 };
  expect((await request(endpoint() + '/commands', 'POST', stale)).body.code).toBe('VERSION_CONFLICT');
  expect((await snapshot()).chartVersion).toBe(2);
});
test('real concurrent posting versus period closure is serialized with no posting after the lock', async () => {
  const posts = Array.from({ length: 8 }, (_, i) => { const p = packet('close-race-' + i); return { ...p, command: { ...p.command, expectedChartVersion: 2, journal: { ...p.command.journal, expectedPeriodVersion: 3 } } }; });
  const close = { protocol: 1, deviceId: device, generation, epoch, dependencies: [], command: {
    kind: 'period-status', commandId: 'final-race-lock', periodId: 'jan', expectedVersion: 3, status: 'locked', reason: 'Synthetic concurrent close',
  } };
  const results = await Promise.all([request(endpoint() + '/commands', 'POST', close), ...posts.map((p) => request(endpoint() + '/commands', 'POST', p))]);
  expect(results[0]?.body.status).toBe('accepted'); const state = await snapshot();
  for (let i = 0; i < posts.length; i++) {
    const status = results[i + 1]!.body; expect(['accepted', 'conflict']).toContain(status.status);
    expect(state.entries.some((e) => e.id === posts[i]!.command.journal.id)).toBe(status.status === 'accepted');
    if (status.status === 'conflict') expect(status.code).toBe('PERIOD_LOCKED');
  }
  expect(state.config.periods[0]?.status).toBe('locked'); trialBalance(state.config, state.entries, '2026-12-31');
});
test('online device revocation pauses the enrolled desktop and cannot be bypassed by recovery', async () => {
  const f = await desktopFixture('native-device-revocation');
  await f.host.native('cloud_enroll', { companyId: f.local.companyId, remoteTenant: tenant, confirmed: true });
  const devices = await ownerSql('SELECT id FROM devices WHERE tenant_id=$1 AND company_id=$2', [tenant, f.local.companyId]);
  const revoked = await request('/v1/tenants/' + tenant + '/companies/' + f.local.companyId + '/revoke-device', 'POST', { deviceId: devices.rows[0].id, reason: 'Synthetic device withdrawal' });
  expect(revoked.status).toBe(200);
  await expect(f.host.native('cloud_sync', { companyId: f.local.companyId })).rejects.toMatchObject({ code: 'DEVICE_REVOKED' });
  await expect(f.service.post(f.actor, { kind: 'post', commandId: 'revoked-post', expectedChartVersion: 1, journal: journal({ ...f.local }) })).rejects.toMatchObject({ code: 'SYNC_REVIEW_REQUIRED' });
  await expect(f.host.native('cloud_recover', { companyId: f.local.companyId, confirmed: true })).rejects.toMatchObject({ code: 'DEVICE_REVOKED' });
  expect((await f.store.read(f.local)).entries).toHaveLength(0);
});
test('simultaneous recovery of one device uses a consistent exclusive lock order', async () => {
  const deviceId = 'concurrent-recovery-device';
  expect((await request(endpoint() + '/join', 'POST', { deviceId, generation: 'before-recovery', sourceTenant: 'recovery-source', sourceCompany: 'recovery-book', confirmed: true })).status).toBe(200);
  const results = await Promise.all(Array.from({ length: 6 }, () => request(endpoint() + '/recover', 'POST', { deviceId, generation: 'after-recovery', confirmed: true })));
  expect(results.every((r) => r.status === 200), encode(results)).toBe(true);
});
test('the real stopped-service recovery tool rotates epochs and preserves immutable financial evidence', async () => {
  const prior = await ownerSql('SELECT tenant_id,company_id,epoch,state FROM cloud_books ORDER BY tenant_id,company_id');
  const port = (server.address() as AddressInfo).port;
  server.closeAllConnections(); await new Promise<void>((done) => server.close(() => done()));
  try {
    const local = JSON.parse(await readFile('.cache/cloud/development.json', 'utf8')) as { port: number; admin: string };
    const { stdout } = await promisify(execFile)(process.execPath, ['tools/cloud-restore-epoch.mjs', '--confirm-service-stopped'], { windowsHide: true,
      env: { ...process.env, DATABASE_URL: 'postgresql://erp_admin:' + local.admin + '@127.0.0.1:' + local.port + '/' + databaseName, ERP_RECOVERY_REASON: 'Synthetic stopped-service restoration drill' } });
    expect(stdout).toContain('Rotated recovery epochs');
    const next = await ownerSql('SELECT tenant_id,company_id,epoch,state FROM cloud_books ORDER BY tenant_id,company_id');
    expect(next.rows).toHaveLength(prior.rows.length);
    for (let i = 0; i < next.rows.length; i++) {expect(next.rows[i].epoch).not.toBe(prior.rows[i].epoch); expect(next.rows[i].state).toBe(prior.rows[i].state);}
  } finally {await new Promise<void>((done) => server.listen(port, '127.0.0.1', done));}
  expect((await request(endpoint() + '/changes?after=0&epoch=' + epoch)).body.error?.code).toBe('GENERATION_CONFLICT');
});
