import { beforeAll, afterAll, afterEach, test, expect } from 'vitest';
import { browserLab } from './harness.js';
import type { Browser } from '@playwright/test';
let lab: Awaited<ReturnType<typeof browserLab>>;
let browser: Browser;
beforeAll(async () => { lab = await browserLab(); browser = await lab.launch(); });
afterAll(async () => { await lab.close(); }, 30000);
afterEach(async () => { await lab.closeContexts(); }, 30000);
test('version-one IndexedDB upgrade preserves rows, blocked upgrades time out without reset, and old clients close on version change', async () => {
    const f = await lab.page(browser);
    const name = f.name + '-migration';
    await f.page.evaluate(async (n) => {
        const open = indexedDB.open(n, 1);
        await new Promise<void>((resolve, reject) => { open.onupgradeneeded = () => { const db = open.result; db.createObjectStore('meta', { keyPath: 'id' }); for (const table of ['books', 'outbox', 'profiles', 'intents', 'enrollments', 'joins', 'resolutions'])
            db.createObjectStore(table, { keyPath: 'key' }); open.transaction!.objectStore('books').createIndex('tenant', 'tenant'); open.transaction!.objectStore('profiles').createIndex('tenant', 'tenant'); open.transaction!.objectStore('meta').put({ id: 'marker', value: 'retained' }); }; open.onsuccess = () => resolve(); open.onerror = () => reject(open.error); });
        (window as unknown as {
            blocker: IDBDatabase;
        }).blocker = open.result;
    }, name);
    await expect(f.page.evaluate(n => window.lab.dbProbe(n), name)).rejects.toThrow('blocking a storage upgrade');
    await f.page.evaluate(() => { (window as unknown as {
        blocker: IDBDatabase;
    }).blocker.close(); });
    await expect.poll(async () => f.page.evaluate(n => window.lab.dbProbe(n), name)).toEqual([{ id: 'marker', value: 'retained' }]);
    await f.page.evaluate(async (n) => { window.lab.init(n); await window.lab.invoke('status'); }, name);
    await f.page.evaluate(async (n) => { const req = indexedDB.open(n, 3); await new Promise<void>((r, j) => { req.onsuccess = () => { req.result.close(); r(); }; req.onerror = () => j(req.error); }); }, name);
    expect((await f.page.evaluate(() => window.lab.info())).stale).toBe(true);
    await expect(f.page.evaluate(() => window.lab.invoke('status'))).rejects.toThrow('reload');
    await expect(f.page.evaluate(n => window.lab.dbProbe(n), name)).rejects.toThrow('upgraded');
}, 30000);
test('actual Chromium quota exhaustion aborts every write and preserves the acknowledged book/outbox', async () => {
    const f = await lab.persistent();
    const cdp = await f.context.newCDPSession(f.page);
    await cdp.send('Storage.overrideQuotaForOrigin', { origin: lab.origin, quotaSize: 1024 * 1024 });
    expect(await cdp.send('Storage.getUsageAndQuota', { origin: lab.origin })).toMatchObject({ quota: 1048576, overrideActive: true });
    // Set the limit before the first write, before Chromium caches bucket space.
    await f.page.evaluate(async () => { await window.lab.setup(); await window.lab.register(); await window.lab.post('prior'); });
    const before = await f.page.evaluate(() => window.lab.summary());
    try {
        await expect(f.page.evaluate(() => window.lab.quota())).rejects.toThrow('storage is full');
    }
    finally {
        await cdp.send('Storage.overrideQuotaForOrigin', { origin: lab.origin });
    }
    expect(await f.page.evaluate(() => window.lab.summary())).toEqual(before);
    expect((await f.page.evaluate(() => window.lab.raw())).outbox).toHaveLength(1);
});
test('controlled site-data loss and closing a private context require an external backup; stale sessions cannot acknowledge writes', async () => {
    const f = await lab.page(browser);
    await f.page.evaluate(async () => { await window.lab.setup(); await window.lab.register(); await window.lab.post('external-only'); });
    const bytes = await f.page.evaluate(() => window.lab.backup());
    const cdp = await f.context.newCDPSession(f.page);
    await cdp.send('Storage.clearDataForOrigin', { origin: lab.origin, storageTypes: 'indexeddb' });
    await expect(f.page.evaluate(() => window.lab.post('lost'))).rejects.toThrow(/restored|replaced|Unlock/);
    await f.context.close();
    const fresh = await lab.page(browser, f.name);
    expect(await fresh.page.evaluate(() => window.lab.invoke('status'))).toMatchObject({ initialized: false });
    await fresh.page.evaluate(() => window.lab.setup());
    await fresh.page.evaluate(b => window.lab.restore(b), bytes);
    await fresh.page.evaluate(() => window.lab.unlock());
    expect((await fresh.page.evaluate(() => window.lab.summary())).entries).toBe(1);
});
test('renderer crash aborts an in-flight IndexedDB transaction without losing earlier acknowledged receipts', async () => {
    const f = await lab.page(browser);
    await f.page.evaluate(async () => { await window.lab.setup(); await window.lab.register(); await window.lab.post('acknowledged'); });
    const before = await f.page.evaluate(() => window.lab.summary());
    await f.page.evaluate(() => window.lab.crashWrite());
    await f.page.waitForFunction(() => Boolean((window as unknown as {
        crashReady: boolean;
    }).crashReady), null, { polling: 100 });
    const session = await f.context.newCDPSession(f.page);
    const crashed = f.page.waitForEvent('crash');
    void session.send('Page.crash').catch(() => { });
    await crashed;
    await f.page.close();
    const reopened = await f.context.newPage();
    await lab.open(reopened, f.name);
    await reopened.evaluate(() => window.lab.unlock());
    expect(await reopened.evaluate(() => window.lab.summary())).toEqual(before);
    expect((await reopened.evaluate(() => window.lab.raw())).outbox).toHaveLength(1);
});
