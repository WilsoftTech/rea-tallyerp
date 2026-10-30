import { beforeAll, afterAll, afterEach, test, expect } from 'vitest';
import { browserLab } from './harness.js';
import { cloudLab } from '../../api/test/lab.js';
import type { Browser, Page } from '@playwright/test';
import { parseBook } from '@erp/contracts';
import { trialBalance } from '@erp/domain';
import { AccountingService } from '@erp/application';
import { LOCAL_PERMISSIONS } from '@erp/workspace/host';
import { journal } from '../../../packages/domain/test/fixtures.js';
import { harness } from '../../desktop/test/native-harness.js';
import { DesktopBookStore } from '../../desktop/src/store.js';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
let cloud: Awaited<ReturnType<typeof cloudLab>>;
let lab: Awaited<ReturnType<typeof browserLab>>;
let browser: Browser;
let sequence = 0;
beforeAll(async () => { cloud = await cloudLab(); lab = await browserLab(cloud.origin); browser = await lab.launch(); }, 30000);
afterAll(async () => { await lab?.close(); await cloud?.close(); }, 30000);
afterEach(async () => { await lab.closeContexts(); }, 30000);
async function fixture(selected = browser) { const f = await lab.page(selected); const company = 'web-' + (++sequence); await f.page.evaluate(async (c) => { await window.lab.setup(); await window.lab.register(c); await window.lab.post('seed-' + c); }, company); await login(f.page); return { ...f, company }; }
async function login(page: Page, username = 'synthetic.owner') { return page.evaluate(({ origin, password, username }) => window.lab.invoke('cloud_login', { endpoint: origin, username, password }), { origin: lab.origin, password: cloud.password, username }); }
async function enroll(page: Page) { await page.evaluate(t => window.lab.invoke('cloud_enroll', { remoteTenant: t, confirmed: true }), cloud.tenant); }
async function snapshot(company: string) { const response = await cloud.request('/v1/tenants/' + cloud.tenant + '/companies/' + company + '/snapshot', 'GET', undefined, cloud.token); expect(response.status).toBe(200); return parseBook(response.body['book']); }
test('browser offline posting and native desktop share canonical results while keeping independent immutable source books', async () => {
    const f = await fixture();
    await enroll(f.page);
    await f.context.setOffline(true);
    await f.page.evaluate(() => window.lab.post('offline', '9007199254740993'));
    expect((await f.page.evaluate(() => window.lab.raw())).outbox.find(d => d.command === 'offline')?.state).toBe('pending');
    await f.context.setOffline(false);
    await f.page.evaluate(() => window.lab.invoke('cloud_sync'));
    const accepted = await snapshot(f.company);
    expect(accepted.entries).toHaveLength(2);
    expect(trialBalance(accepted.config, accepted.entries, '2026-12-31').debit).toBe(9007199254741993n);
    const directory = await mkdtemp(join(tmpdir(), 'erp-web-native-'));
    const native = harness(join(directory, 'accounting.sqlite'));
    try {
        const auth = await native.native<{
            token: string;
            tenantId: string;
        }>('setup', { password: 'Synthetic browser password 2026' });
        native.setToken(auth.token);
        await native.native('cloud_login', { endpoint: cloud.origin, username: 'synthetic.owner', password: cloud.password });
        const joined = await native.native<{
            companyId: string;
        }>('cloud_join', { remoteTenant: cloud.tenant, remoteCompany: f.company, confirmed: true });
        const status = await native.native<{
            canonical: unknown;
        }>('cloud_status', { companyId: joined.companyId });
        const canonical = parseBook(status.canonical);
        expect(canonical.entries).toEqual(accepted.entries);
        const source = await new DesktopBookStore(native.native).read({ tenantId: auth.tenantId, companyId: joined.companyId });
        expect(source.entries).toHaveLength(0);
        const scope={tenantId:auth.tenantId,companyId:joined.companyId};
        const service=new AccountingService(new DesktopBookStore(native.native),()=> '2026-01-15T12:00:00.000Z');
        await service.post({...scope,actorId:'local-owner',permissions:LOCAL_PERMISSIONS},{kind:'post',commandId:'native-to-browser',expectedChartVersion:1,journal:journal({...scope,id:'native-peer-journal',lines:[{ledgerId:'cash',side:'debit',amount:300n},{ledgerId:'equity',side:'credit',amount:300n}]})});
        await native.native('cloud_sync',{companyId:joined.companyId});
        await f.page.evaluate(()=>window.lab.invoke('cloud_sync'));
        const returned=parseBook(JSON.parse((await f.page.evaluate(()=>window.lab.raw())).profiles[0]!.canonical) as unknown);
        expect(returned.entries).toHaveLength(3);
        expect(trialBalance(returned.config,returned.entries,'2026-12-31').debit).toBe(9007199254742293n);
    }
    finally {
        await native.close();
    }
    expect((await f.page.evaluate(() => window.lab.summary())).entries).toBe(2);
}, 30000);
test('lost command acknowledgment reconciles after reload without changing command ID or duplicating a journal', async () => {
    const f = await fixture();
    await enroll(f.page);
    await f.page.evaluate(() => window.lab.post('lost-ack', '200'));
    let dropped = false;
    await f.page.route('**/api/accounting/**/commands', async (route) => { if (!dropped) {
        dropped = true;
        await route.fetch();
        await route.abort('failed');
    }
    else
        await route.continue(); });
    await expect(f.page.evaluate(() => window.lab.invoke('cloud_sync'))).rejects.toThrow('unknown');
    expect(dropped).toBe(true);
    expect((await snapshot(f.company)).entries).toHaveLength(2);
    expect((await f.page.evaluate(() => window.lab.raw())).outbox.find(d => d.command === 'lost-ack')?.state).toBe('pending');
    await f.page.unrouteAll();
    await lab.open(f.page, f.name);
    await f.page.evaluate(async (c) => { await window.lab.unlock(); window.lab.select(c); }, f.company);
    await login(f.page);
    await f.page.evaluate(() => window.lab.invoke('cloud_sync'));
    expect((await f.page.evaluate(() => window.lab.raw())).outbox.find(d => d.command === 'lost-ack')?.state).toBe('accepted');
    expect((await snapshot(f.company)).entries).toHaveLength(2);
});
test('lost enrollment acknowledgment retains its frozen seed while retry returns current epoch, cursor and other-device changes', async () => {
    const f = await fixture();
    let dropped = false;
    await f.page.route('**/api/accounting/v1/tenants/*/companies', async (route) => { if (route.request().method() === 'POST' && !dropped) {
        dropped = true;
        await route.fetch();
        await route.abort('failed');
    }
    else
        await route.continue(); });
    await expect(enroll(f.page)).rejects.toThrow('unknown');
    const raw = await f.page.evaluate(() => window.lab.raw());
    expect(raw.enrollments).toHaveLength(1);
    await f.page.unrouteAll();
    const book = await snapshot(f.company);
    const base = '/v1/tenants/' + cloud.tenant + '/companies/' + f.company;
    const changedEpoch = 'new-epoch-' + f.company;
    await cloud.sql('UPDATE cloud_books SET epoch=$1 WHERE tenant_id=$2 AND company_id=$3', [changedEpoch, cloud.tenant, f.company]);
    expect((await cloud.request(base + '/join', 'POST', { deviceId: 'peer-' + f.company, generation: 'peer-generation', sourceTenant: 'peer-source', sourceCompany: 'peer-company', confirmed: true }, cloud.token)).status).toBe(200);
    expect((await cloud.request(base + '/commands', 'POST', { protocol: 1, deviceId: 'peer-' + f.company, generation: 'peer-generation', epoch: changedEpoch, dependencies: [], command: { kind: 'post', commandId: 'peer-post', expectedChartVersion: 1, journal: journal({ tenantId: 'peer-source', companyId: 'peer-company', id: 'peer-journal' }) } }, cloud.token)).body['status']).toBe('accepted');
    await f.page.evaluate(() => window.lab.post('after-reviewed-seed', '300'));
    await enroll(f.page);
    const installed = await f.page.evaluate(() => window.lab.raw());
    expect(installed.profiles[0]!.epoch).toBe(changedEpoch);
    expect(installed.outbox.find(d => d.command === 'after-reviewed-seed')?.state).toBe('pending');
    expect(installed.enrollments).toHaveLength(0);
    expect(parseBook(JSON.parse(installed.profiles[0]!.canonical) as unknown).entries).toHaveLength(book.entries.length + 1);
    await f.page.evaluate(() => window.lab.invoke('cloud_sync'));
    expect((await snapshot(f.company)).entries).toHaveLength(book.entries.length + 2);
});
test('cloud period conflict preserves the source journal, allows explicit device compensation and reconciles encrypted restore generation', async () => {
    const f = await fixture();
    await enroll(f.page);
    const bytes = await f.page.evaluate(() => window.lab.backup());
    await f.page.evaluate(() => window.lab.post('stale-period', '200'));
    await f.page.evaluate(() => window.lab.invoke('cloud_command', { command: { kind: 'period-status', commandId: 'lock-jan', periodId: 'jan', expectedVersion: 1, status: 'locked', reason: 'Synthetic close' } }));
    await f.page.evaluate(() => window.lab.invoke('cloud_sync'));
    let raw = await f.page.evaluate(() => window.lab.raw());
    expect(raw.outbox.find(d => d.command === 'stale-period')).toMatchObject({ state: 'conflict', lastError: 'PERIOD_LOCKED' });
    await f.page.evaluate(() => window.lab.compensate('device-contra', 'stale-period'));
    raw = await f.page.evaluate(() => window.lab.raw());
    expect(raw.outbox.find(d => d.command === 'device-contra')).toMatchObject({ localOnly: true, state: 'not-enrolled' });
    expect((await snapshot(f.company)).entries).toHaveLength(1);
    await f.page.evaluate(b => window.lab.restore(b), bytes);
    await f.page.evaluate(() => window.lab.unlock());
    await expect(f.page.evaluate(() => window.lab.post('stale-generation'))).rejects.toThrow(/authority|recovery|restored/i);
    await login(f.page);
    await f.page.evaluate(() => window.lab.invoke('cloud_recover', { confirmed: true }));
    raw = await f.page.evaluate(() => window.lab.raw());
    expect(raw.profiles[0]!.generation).toBe(raw.meta[0]!.generation);
    expect(raw.profiles[0]!.paused).toBeNull();
    await f.page.evaluate(() => window.lab.invoke('cloud_sync'));
    expect((await snapshot(f.company)).entries).toHaveLength(1);
}, 30000);
test('service-account change removes live bearer authority and cannot install a delayed response from the previous account', async () => {
    const f = await fixture();
    await enroll(f.page);
    let release: () => void = () => { };
    const gate = new Promise<void>(r => { release = r; });
    let captured = false;
    await f.page.route('**/api/accounting/**/grant', async (route) => { const response = await route.fetch(); captured = true; await gate; await route.fulfill({ response }); });
    const pending = f.page.evaluate(() => window.lab.invoke('cloud_sync')).then(() => null, e => String(e));
    await expect.poll(() => captured).toBe(true);
    await f.page.evaluate(() => window.lab.invoke('cloud_logout'));
    release();
    expect(await pending).toMatch(/session changed|sign in/i);
    const raw = await f.page.evaluate(() => window.lab.raw());
    expect(raw.profiles[0]!.paused).toBe('signed-out');
    expect(JSON.stringify(raw)).not.toContain(cloud.token);
    expect((await f.page.evaluate(() => window.lab.invoke('cloud_status')) as {
        session: unknown;
    }).session).toBeNull();
});
for (const label of ['Firefox', 'Edge'])
    test(label + ': actual Ed25519 grant permits exact offline work and scoped synchronization', async () => {
        const selected = await lab.launch(label);
        const f = await fixture(selected);
        await enroll(f.page);
        await f.context.setOffline(true);
        await f.page.evaluate(() => window.lab.post('grant-offline', '200'));
        await f.context.setOffline(false);
        await f.page.evaluate(() => window.lab.invoke('cloud_sync'));
        expect((await snapshot(f.company)).entries).toHaveLength(2);
    }, 30000);
test('expired or tampered offline grants deny posting while reports and encrypted backup remain available', async () => {
    const f = await fixture();
    await enroll(f.page);
    const original = await f.page.evaluate(() => window.lab.raw());
    await f.page.evaluate(() => { const original = Date.now; Date.now = () => original() + 86401000; });
    await expect(f.page.evaluate(() => window.lab.post('expired'))).rejects.toThrow('expired');
    expect((await f.page.evaluate(() => window.lab.summary())).entries).toBe(1);
    expect((await f.page.evaluate(() => window.lab.backup())).length).toBeGreaterThan(56);
    await lab.open(f.page, f.name);
    await f.page.evaluate(async (c) => { await window.lab.unlock(); window.lab.select(c); }, f.company);
    await f.page.evaluate(async (n) => { const req = indexedDB.open(n); const db = await new Promise<IDBDatabase>((r, j) => { req.onsuccess = () => r(req.result); req.onerror = () => j(req.error); }); await new Promise<void>((r, j) => { const tx = db.transaction('profiles', 'readwrite'); const records = tx.objectStore('profiles').getAll(); records.onsuccess = () => { const p = records.result[0] as {
        grant: {
            signature: string;
        };
    }; p.grant.signature = 'A'.repeat(86); tx.objectStore('profiles').put(p); }; tx.oncomplete = () => r(); tx.onabort = () => j(tx.error); }); db.close(); }, f.name);
    await expect(f.page.evaluate(() => window.lab.post('tampered'))).rejects.toThrow('signature');
    expect((await f.page.evaluate(() => window.lab.summary())).entries).toBe(1);
    expect((await f.page.evaluate(() => window.lab.raw())).outbox).toEqual(original.outbox);
});
test('a device revoked after grant renewal is paused atomically with its durable rejection', async () => {
    const f = await fixture();
    await enroll(f.page);
    await f.page.evaluate(() => window.lab.post('revocation-race'));
    const p = (await f.page.evaluate(() => window.lab.raw())).profiles[0]!;
    let revoked = false;
    await f.page.route('**/api/accounting/**/commands', async (route) => { if (!revoked) {
        revoked = true;
        const response = await cloud.request('/v1/tenants/' + cloud.tenant + '/companies/' + f.company + '/revoke-device', 'POST', { deviceId: p.deviceId, reason: 'Synthetic after-renewal race' }, cloud.token);
        expect(response.status).toBe(200);
    } await route.continue(); });
    await expect(f.page.evaluate(() => window.lab.invoke('cloud_sync'))).rejects.toThrow(/authorized|revoked/i);
    const raw = await f.page.evaluate(() => window.lab.raw());
    expect(raw.profiles[0]!.paused).toBe('device-revoked');
    expect(raw.outbox.find(d => d.command === 'revocation-race')).toMatchObject({ state: 'rejected', lastError: 'DEVICE_REVOKED' });
    await expect(f.page.evaluate(() => window.lab.post('after-revoked'))).rejects.toThrow('review');
    expect((await snapshot(f.company)).entries).toHaveLength(1);
});
test('a company-scoped viewer can read its canonical mirror but cannot post offline or access another company', async () => {
    const owner = await fixture();
    await enroll(owner.page);
    const username = 'synthetic.viewer' + sequence;
    const added = await cloud.request('/v1/tenants/' + cloud.tenant + '/members', 'POST', { username, password: cloud.password, role: 'viewer', companies: [owner.company], reason: 'Synthetic browser viewer' }, cloud.token);
    expect(added.status).toBe(201);
    const viewer = await lab.page(browser);
    await viewer.page.evaluate(() => window.lab.setup());
    await login(viewer.page, username);
    const joined = await viewer.page.evaluate(t => window.lab.invoke('cloud_join', { remoteTenant: t.tenant, remoteCompany: t.company, confirmed: true }), { tenant: cloud.tenant, company: owner.company }) as {
        companyId: string;
    };
    await viewer.page.evaluate(c => window.lab.select(c), joined.companyId);
    const status = await viewer.page.evaluate(() => window.lab.invoke('cloud_status')) as {
        permissions: string[];
    };
    expect(status.permissions).toEqual(['read']);
    await expect(viewer.page.evaluate(() => window.lab.post('viewer-invalid'))).rejects.toThrow('permissions');
    const other = await fixture();
    await enroll(other.page);
    await expect(viewer.page.evaluate(t => window.lab.invoke('cloud_join', { remoteTenant: t.tenant, remoteCompany: t.company, confirmed: true }), { tenant: cloud.tenant, company: other.company })).rejects.toThrow(/authorized|assigned|permitted|access/i);
    expect((await snapshot(owner.company)).entries).toHaveLength(1);
});
test('a delayed login cannot replace an explicit sign-out or a newer local session', async () => {
    const f = await fixture();
    let release: () => void = () => { };
    const gate = new Promise<void>(r => { release = r; });
    let captured = false;
    await f.page.route('**/api/accounting/v1/auth/login', async (route) => { const response = await route.fetch(); captured = true; await gate; await route.fulfill({ response }); });
    const pending = login(f.page).then(() => null, e => String(e));
    await expect.poll(() => captured).toBe(true);
    await f.page.evaluate(() => window.lab.invoke('cloud_logout'));
    release();
    expect(await pending).toContain('superseded');
    expect((await f.page.evaluate(() => window.lab.invoke('cloud_status')) as {
        session: unknown;
    }).session).toBeNull();
});
