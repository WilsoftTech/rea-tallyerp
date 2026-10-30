import { beforeAll, afterAll, afterEach, test, expect } from 'vitest';
import { chromium, firefox, expect as browserExpect } from '@playwright/test';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFile, mkdtemp } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
let next: ChildProcess;
let front: ReturnType<typeof createServer>;
let origin: string;
let version = 1;
const browsers: Browser[] = [];
const contexts: BrowserContext[] = [];
const password = 'Synthetic browser password 2026';
beforeAll(async () => {
    const reservation = createServer();
    await new Promise<void>(r => reservation.listen(0, '127.0.0.1', r));
    const port = (reservation.address() as AddressInfo).port;
    await new Promise<void>(r => reservation.close(() => r()));
    let startupError = false;
    next = spawn(process.execPath, [resolve('node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', String(port)], { cwd: resolve('apps/web'), windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' } });
    next.on('error', () => { startupError = true; });
    next.stderr?.on('data', () => { });
    const target = 'http://127.0.0.1:' + port;
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
        if (startupError || next.exitCode !== null)
            throw Error('Production web server failed to start. Build @erp/web first.');
        try {
            ready = (await fetch(target)).status === 200;
        }
        catch { /* owned server startup */ }
        if (ready)
            break;
        await new Promise(r => setTimeout(r, 250));
    }
    if (!ready)
        throw Error('Production web server startup timed out.');
    const worker = await readFile(resolve('apps/web/public/sw.js'), 'utf8');
    front = createServer((req, res) => {
        void (async () => {
            if (req.url === '/sw.js') {
                res.writeHead(200, { 'content-type': 'application/javascript', 'cache-control': 'no-store', 'service-worker-allowed': '/' });
                res.end(worker.replace(/erp-public-shell-([a-f0-9]+)/g, 'erp-public-shell-$1-test' + version));
                return;
            }
            const response = await fetch(target + req.url, { headers: { 'accept': req.headers.accept ?? '*/*' }, redirect: 'manual' });
            res.writeHead(response.status, Object.fromEntries([...response.headers].filter(([k]) => !['content-encoding', 'transfer-encoding', 'content-length'].includes(k))));
            res.end(new Uint8Array(await response.arrayBuffer()));
        })().catch(() => { res.writeHead(503); res.end(); });
    });
    await new Promise<void>(r => front.listen(0, '127.0.0.1', r));
    origin = 'http://127.0.0.1:' + (front.address() as AddressInfo).port;
}, 30000);
afterAll(async () => { for (const c of contexts)
    await c.close(); for (const b of browsers)
    await b.close(); front?.closeAllConnections(); if (front)
    await new Promise<void>(r => front.close(() => r())); if (next && next.exitCode === null) {
    next.kill();
} }, 30000);
afterEach(async () => { for (const b of browsers.splice(0))
    await b.close(); contexts.length = 0; }, 30000);
async function page(index = 0) { const browser = index === 1 ? await firefox.launch({ executablePath: resolve('.cache/playwright/firefox-1555/firefox/firefox.exe'), headless: true }) : await chromium.launch({ executablePath: index === 2 ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true }); browsers.push(browser); const context = await browser.newContext({ acceptDownloads: true }); contexts.push(context); const page = await context.newPage(); await page.goto(origin); await browserExpect(page.getByRole('heading', { name: 'Set up this device' })).toBeVisible(); return { page, context }; }
async function setup(page: Page) { await page.getByLabel('Device password', { exact: true }).fill(password); await page.getByLabel('Confirm device password', { exact: true }).fill(password); await page.getByLabel('Confirm device password', { exact: true }).press('Enter'); await browserExpect(page.getByLabel('Company name')).toBeVisible(); }
async function saved(page: Page) { await browserExpect(page.getByRole('status').filter({ hasText: 'Saved on this device' })).toBeVisible(); }
async function create(page: Page) { await page.getByLabel('Company name').fill('Synthetic Browser Lab'); await page.getByLabel('Currency code (three uppercase letters)').fill('UGX'); await page.getByLabel('Currency decimal places (0–6)').fill('0'); await page.getByLabel('Start date', { exact: true }).fill('2026-01-01'); await page.getByLabel('End date', { exact: true }).fill('2026-12-31'); await page.getByLabel('Books beginning', { exact: true }).fill('2026-01-01'); await page.getByRole('button', {name:'Create company', exact:true}).press('Enter'); await saved(page); }
async function ledger(page: Page, name: string, nature: string, kind: string) { const form = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Ledgers', exact: true }) }).locator('form'); await form.getByLabel('Ledger name').fill(name); await form.getByLabel('Group').selectOption({ label: nature + ' · ' + nature.toLowerCase() }); await form.getByLabel('Ledger kind').selectOption(kind); await form.getByRole('button', { name: 'Add ledger', exact: true }).click(); await saved(page); await browserExpect(page.getByRole('table').filter({ hasText: name })).toBeVisible(); }
async function post(page: Page, narration = 'Synthetic capital') { await page.getByRole('button', { name: 'Journal entry', exact: true }).click(); const form = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Record a journal', exact: true }) }).locator('form'); await form.getByLabel('Journal date').fill('2026-02-15'); await form.getByLabel('Ledger 1', { exact: true }).selectOption({ label: 'Cash' }); await form.getByLabel('Ledger 2', { exact: true }).selectOption({ label: 'Equity' }); await form.getByLabel('Amount 1', { exact: true }).fill('1000'); await form.getByLabel('Amount 2', { exact: true }).fill('1000'); await form.getByLabel('Narration', { exact: true }).fill(narration); await form.getByLabel('Narration', { exact: true }).press('Enter'); await saved(page); }
async function unlock(page: Page) { await browserExpect(page.getByRole('heading', { name: 'Unlock your workspace' })).toBeVisible(); await page.getByLabel('Device password', { exact: true }).fill(password); await page.getByRole('button', { name: 'Unlock', exact: true }).click(); await page.getByLabel('Company', { exact: true }).selectOption({ label: 'Synthetic Browser Lab' }); }
async function reports(page: Page) { await page.getByRole('button', { name: 'Reports', exact: true }).click(); await page.getByLabel('Start date', { exact: true }).fill('2026-01-01'); await page.getByLabel('End date', { exact: true }).fill('2026-12-31'); await page.getByRole('button', { name: 'Apply report period', exact: true }).click(); return page.getByRole('table', { name: 'Trial balance', exact: true }); }
for (const [index, label] of ['Chrome', 'Firefox', 'Edge'].entries())
    test(label + ': production public shell reopens offline, validates dates accessibly and retains exact local journals', async () => {
        const f = await page(index);
        await setup(f.page);
        await f.page.getByLabel('Company name').fill('Invalid synthetic company');
        await f.page.getByLabel('Currency code (three uppercase letters)').fill('UGX');
        await f.page.getByLabel('Currency decimal places (0–6)').fill('0');
        await f.page.getByLabel('Start date', { exact: true }).fill('2026-02-28');
        await f.page.getByLabel('End date', { exact: true }).fill('2026-02-01');
        await f.page.getByLabel('Books beginning', { exact: true }).fill('2026-01-01');
        await f.page.getByRole('button', { name: 'Create company', exact: true }).press('Enter');
        const end = f.page.getByLabel('End date', { exact: true });
        await browserExpect(end).toHaveAttribute('aria-invalid', 'true');
        await browserExpect(end).toBeFocused();
        expect(await end.evaluate(el => document.getElementById(el.getAttribute('aria-describedby') ?? '')?.textContent)).toBe('End date must be on or after start date.');
        expect(await f.page.getByLabel('Company', { exact: true }).locator('option').count()).toBe(1);
        await create(f.page);
        await ledger(f.page, 'Cash', 'Asset', 'cash');
        await ledger(f.page, 'Equity', 'Equity', 'general');
        await post(f.page);
        await f.page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, { polling: 100, timeout: 10000 });
        const caches = await f.page.evaluate(async () => { const entries = []; for (const name of await window.caches.keys()) {
            const cache = await window.caches.open(name);
            for (const request of await cache.keys()) {
                const path = new URL(request.url).pathname;
                entries.push({ path, text: path === '/' ? await (await cache.match(request))!.text() : '' });
            }
        } return entries; });
        expect(caches.some(c => c.path === '/')).toBe(true);
        expect(caches.every(c => c.path === '/' || c.path.startsWith('/_next/static/') || ['/icon.svg', '/manifest.webmanifest'].includes(c.path))).toBe(true);
        expect(caches.find(c => c.path === '/')!.text).not.toContain('Synthetic Browser Lab');
        await f.context.setOffline(true);
        await f.page.reload();
        await unlock(f.page);
        const table = await reports(f.page);
        await browserExpect(table.getByRole('row').filter({ hasText: 'Cash' })).toContainText('1000');
        await post(f.page, 'Offline second capital');
        const after = await reports(f.page);
        await browserExpect(after.getByRole('row').filter({ hasText: 'Cash' })).toContainText('2000');
    }, 60000);
test('waiting service-worker update preserves unsynchronized work and activates only after all old tabs close', async () => {
    const f = await page();
    await setup(f.page);
    await create(f.page);
    await ledger(f.page, 'Cash', 'Asset', 'cash');
    await ledger(f.page, 'Equity', 'Equity', 'general');
    await post(f.page);
    await f.page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, { polling: 100 });
    const other = await f.context.newPage();
    await other.goto(origin);
    version++;
    await f.page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); await r!.update(); });
    await expect.poll(() => f.page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration())?.waiting)), { timeout: 10000 }).toBe(true);
    const active = await f.page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return { caches: await caches.keys(), active: r?.active?.state ?? null, waiting: r?.waiting?.state ?? null, controller: navigator.serviceWorker.controller?.state ?? null }; });
    expect(active.waiting).toBe('installed');
    expect(active.active).toBe('activated');
    await f.page.close();
    await other.close();
    // With no tabs open, observe activation from the worker itself before reopening; an immediate navigation races the hand-over.
    await expect.poll(async () => { for (const w of f.context.serviceWorkers()) { const state = await w.evaluate(async () => { const r = (self as unknown as { registration: ServiceWorkerRegistration }).registration; return { waiting: Boolean(r.waiting), active: r.active?.state ?? null, caches: await caches.keys() }; }).catch(() => null); if (state && !state.waiting && state.active === 'activated' && state.caches.length === 1) return state.caches[0]; } return null; }, { timeout: 10000 }).toContain('test' + version);
    const reopened = await f.context.newPage();
    await reopened.goto(origin, {timeout:10000});
    await unlock(reopened);
    await browserExpect((await reports(reopened)).getByRole('row').filter({ hasText: 'Cash' })).toContainText('1000');
    await expect.poll(() => reopened.evaluate(async () => await caches.keys())).toHaveLength(1);
    expect((await reopened.evaluate(async () => await caches.keys()))[0]).toContain('test' + version);
}, 60000);
test('browser requests persistence explicitly, reports denial, and downloads/restores an actual encrypted external file', async () => {
    const f = await page();
    await f.page.evaluate(() => { Object.defineProperty(navigator.storage, 'persist', { value: async () => false, configurable: true }); });
    await f.page.getByRole('button', { name: 'Request persistent storage' }).click();
    await browserExpect(f.page.getByRole('status').filter({ hasText: 'not granted' })).toBeVisible();
    await setup(f.page);
    await create(f.page);
    await ledger(f.page, 'Cash', 'Asset', 'cash');
    await ledger(f.page, 'Equity', 'Equity', 'general');
    await post(f.page);
    await f.page.getByRole('button', { name: 'Backup & recovery', exact: true }).click();
    await f.page.getByLabel('Backup encryption passphrase').fill('Synthetic backup phrase 2026');
    const download = f.page.waitForEvent('download');
    await f.page.getByRole('button', { name: 'Choose backup file', exact: true }).click();
    const exported = await download;
    const directory = await mkdtemp(join(tmpdir(), 'erp-external-browser-'));
    const file = join(directory, 'synthetic.erpwebbackup');
    await exported.saveAs(file);
    expect((await readFile(file)).subarray(0, 8).toString()).toBe('ERPWEB01');
    await post(f.page, 'After backup');
    await f.page.getByRole('button', { name: 'Backup & recovery', exact: true }).click();
    await f.page.getByLabel('Operation', { exact: true }).selectOption('restore');
    await f.page.getByLabel('Backup encryption passphrase').fill('Synthetic backup phrase 2026');
    await f.page.getByLabel(/I have made a current backup/).check();
    const chooser = f.page.waitForEvent('filechooser');
    await f.page.getByRole('button', { name: 'Choose backup file', exact: true }).click();
    await (await chooser).setFiles(file);
    await unlock(f.page);
    await browserExpect((await reports(f.page)).getByRole('row').filter({ hasText: 'Cash' })).toContainText('1000');
}, 60000);
