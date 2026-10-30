import { beforeAll, afterAll, afterEach, expect, test } from 'vitest';
import { browserLab } from './harness.js';
import type {} from './bridge.js';
let lab: Awaited<ReturnType<typeof browserLab>>;
let origin: string;
beforeAll(async () => {
    lab = await browserLab();
    origin = lab.origin;
}, 30000);
afterAll(async () => { await lab?.close(); }, 30000);
afterEach(async () => { await lab.closeBrowsers(); }, 30000);
const page = async (label: string) => lab.page(await lab.launch(label));
for (const label of ['Chrome', 'Firefox', 'Edge']) {
    test(label + ': exact postings, duplicate prevention, full reversal, immutable history and cross-tab CAS survive restart', async () => {
        const f = await page(label);
        await f.page.evaluate(() => window.lab.setup());
        await f.page.evaluate(() => window.lab.register());
        await f.page.evaluate(() => window.lab.post('seed'));
        const other = await f.context.newPage();
        await lab.open(other, f.name);
        await other.evaluate(() => window.lab.unlock());
        await Promise.all([f.page.evaluate(() => window.lab.post('duplicate', '9007199254740993')), other.evaluate(() => window.lab.post('duplicate', '9007199254740993'))]);
        await Promise.all([f.page.evaluate(() => window.lab.post('writer-a', '200')), other.evaluate(() => window.lab.post('writer-b', '300'))]);
        await f.page.evaluate(() => window.lab.reverse('reverse', 'seed'));
        const before = await f.page.evaluate(() => window.lab.summary());
        expect(before).toMatchObject({ entries: 5, receipts: 5, audit: 5, debit: '9007199254741493', credit: '9007199254741493' });
        await expect(f.page.evaluate(() => window.lab.tamper())).rejects.toThrow();
        expect(await f.page.evaluate(() => window.lab.summary())).toEqual(before);
        await expect(f.page.evaluate(() => window.lab.abort())).rejects.toThrow('Synthetic abort');
        expect(await f.page.evaluate(() => window.lab.summary())).toEqual(before);
        expect((await f.page.evaluate(() => window.lab.raw())).outbox).toHaveLength(5);
        await other.close();
        await f.page.reload();
        await f.page.waitForFunction(() => Boolean(window.lab),null,{polling:100,timeout:5000});
        await f.page.evaluate(async (name) => { window.lab.init(name); await window.lab.unlock(); }, f.name);
        expect(await f.page.evaluate(() => window.lab.summary())).toEqual(before);
        expect((await f.page.evaluate(() => window.lab.info())).durability).toBe('default'); // readonly since restart; write durability tested separately.
    }, 60000);
    test(label + ': encrypted backup rejects wrong key/tampering/malformed metadata, restores atomically and invalidates other tabs', async () => {
        const f = await page(label);
        await f.page.evaluate(async () => { await window.lab.setup(); await window.lab.register(); await window.lab.post('saved'); });
        const bytes = await f.page.evaluate(() => window.lab.backup());
        const before = await f.page.evaluate(() => window.lab.summary());
        expect(new TextDecoder().decode(new Uint8Array(bytes)).includes('Synthetic Engine Lab')).toBe(false);
        await expect(f.page.evaluate(b => window.lab.restore(b, 'Wrong backup password 2026'), bytes)).rejects.toThrow('Wrong passphrase');
        const damaged = [...bytes];
        damaged[damaged.length - 1] = damaged[damaged.length - 1]! ^ 1;
        await expect(f.page.evaluate(b => window.lab.restore(b), damaged)).rejects.toThrow('Wrong passphrase');
        for (const mode of ['duplicate', 'metadata']) {
            const bad = await f.page.evaluate(({ b, m }) => window.lab.malformedBackup(b, m), { b: bytes, m: mode });
            await expect(f.page.evaluate(b => window.lab.restore(b), bad)).rejects.toThrow();
        }
        expect(await f.page.evaluate(() => window.lab.summary())).toEqual(before);
        const other = await f.context.newPage();
        await other.goto(origin + '/lab');
        await other.waitForFunction(() => Boolean(window.lab),null,{polling:100,timeout:5000});
        await other.evaluate(async (n) => { window.lab.init(n); await window.lab.unlock(); }, f.name);
        await f.page.evaluate(() => window.lab.post('later'));
        await f.page.evaluate(b => window.lab.restore(b), bytes);
        await expect(other.evaluate(() => window.lab.post('stale'))).rejects.toThrow(/Unlock|restored|replaced/);
        await f.page.evaluate(() => window.lab.unlock());
        expect(await f.page.evaluate(() => window.lab.summary())).toEqual(before);
    }, 60000);
    test(label + ': company isolation and structured invalid period rejection hold at the browser commit boundary', async () => {
        const f = await page(label);
        await f.page.evaluate(async () => { await window.lab.setup(); await window.lab.register(); await window.lab.post('a'); await window.lab.register('company-b'); });
        expect((await f.page.evaluate(() => window.lab.summary())).entries).toBe(0);
        await expect(f.page.evaluate(() => window.lab.invoke('read_book', { companyId: 'absent' }))).rejects.toThrow('Select an existing company');
        await expect(f.page.evaluate(async () => { const value = await window.lab.invoke('read_book') as {
            revision: number;
            state: string;
        }; const book = JSON.parse(value.state) as {
            config: {
                periods: {
                    end: string;
                }[];
            };
        }; book.config.periods[0]!.end = '2025-01-01'; return window.lab.invoke('commit_book', { ...value, state: JSON.stringify(book) }); })).rejects.toThrow(/end|range|date/i);
        await f.page.evaluate(() => window.lab.select('company-a'));
        expect((await f.page.evaluate(() => window.lab.summary())).entries).toBe(1);
        expect((await f.page.evaluate(() => window.lab.info())).durability).toBe('strict');
    });
}
