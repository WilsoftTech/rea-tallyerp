import { createServer } from 'vite';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { chromium, firefox } from '@playwright/test';
import { resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type {} from './bridge.js';
export async function browserLab(proxy?: string) {
    const server = await createServer({ configFile: false, root: resolve('apps/web/test'), resolve: { alias: {
                '@erp/contracts/reconcile': resolve('packages/contracts/src/reconcile.ts'), '@erp/contracts/codec': resolve('packages/contracts/src/codec.ts'),
                '@erp/contracts': resolve('packages/contracts/src/index.ts'), '@erp/domain': resolve('packages/domain/src/index.ts'), '@erp/application': resolve('packages/application/src/index.ts'),
            } }, plugins: [{ name: 'synthetic-browser-lab', configureServer(s) { s.middlewares.use((req, res, next) => { if (req.url === '/lab') {
                    res.setHeader('Content-Type', 'text/html');
                    res.end('<!doctype html><html lang="en"><title>Synthetic IDB adapter lab</title><script type="module" src="/bridge.ts"></script><body>Isolated synthetic test harness</body></html>');
                }
                else
                    next(); }); } }], optimizeDeps: { noDiscovery: true, include: [] }, server: { host: '127.0.0.1', port: 0, strictPort: true, fs: { allow: [resolve('.')] }, watch: { ignored: ['**/.cache/**', '**/target/**', '**/.next/**', '**/local-data/**'] }, ...(proxy ? { proxy: { '/api/accounting': { target: proxy, rewrite: (path: string) => path.slice('/api/accounting'.length) } } } : {}) }, logLevel: 'error' });
    await server.listen();
    const origin = 'http://127.0.0.1:' + (server.httpServer!.address() as AddressInfo).port;
    const browsers: Browser[] = [];
    const contexts: BrowserContext[] = [];
    return { origin, browsers,
        async launch(label = 'Chrome') { const browser = label === 'Firefox' ? await firefox.launch({ executablePath: resolve('.cache/playwright/firefox-1555/firefox/firefox.exe'), headless: true }) : await chromium.launch({ executablePath: label === 'Edge' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true }); browsers.push(browser); return browser; },
        async page(browser: Browser, name = 'verify-' + randomUUID()) { const context = await browser.newContext(); contexts.push(context); const page = await context.newPage(); await open(page, name); return { page, context, name }; },
        async persistent() { const directory = await mkdtemp(resolve(tmpdir(), 'erp-quota-profile-')); const context = await chromium.launchPersistentContext(directory, { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true }); contexts.push(context); const page = await context.newPage(); const name = 'verify-' + randomUUID(); await open(page, name); return { page, context, name }; },
        async open(page: Page, name: string) { await open(page, name); },
        async closeContexts() { for (const c of contexts.splice(0))
            await c.close(); },
        async closeBrowsers() { for (const b of browsers.splice(0))
            await b.close(); contexts.length = 0; },
        async close() { for (const c of contexts.splice(0))
            await c.close(); for (const b of browsers)
            await b.close(); await server.close(); },
    };
    async function open(page: Page, name: string) { const errors: string[] = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error')
        errors.push(m.text()); }); await page.goto(origin + '/lab'); try {
        await page.waitForFunction(() => Boolean(window.lab), null, { timeout: 5000, polling: 100 });
    }
    catch {
        throw Error('Browser adapter did not load: ' + errors.join('\n').slice(0, 3000));
    } await page.evaluate(n => window.lab.init(n), name); }
}
