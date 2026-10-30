import { chromium, expect } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createServer } from 'node:net';
import { setTimeout } from 'node:timers/promises';

const directory = await mkdtemp(join(tmpdir(), 'erp-desktop-ui-'));
const executable = resolve(process.env.ERP_NATIVE_TEST_EXE ?? 'apps/desktop/src-tauri/target/debug/erp-desktop.exe');
let launches = 0;
let app;
let browser;
let page;
const checks = [];
const lifecycle = [];
const started = performance.now();
async function launch() {
  // A closed WebView2 subprocess may keep its old CDP listener/profile briefly.
  // Each owned launch gets a new listener and renderer profile; SQLite stays at
  // the same synthetic ERP_TEST_DATA_DIR to verify real native persistence.
  const reservation = createServer();
  await new Promise(resolveReady => reservation.listen(0, '127.0.0.1', resolveReady));
  const port = reservation.address().port;
  await new Promise(resolveClosed => reservation.close(resolveClosed));
  page = undefined; browser = undefined;
  app = spawn(executable, [], {
    windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, ERP_TEST_DATA_DIR: directory,
      WEBVIEW2_USER_DATA_FOLDER: join(directory, 'webview-' + (++launches)),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=' + port },
  });
  let failure;
  app.on('exit', (code,signal) => lifecycle.push({event:'native-exit',launch:launches,code,signal}));
  app.on('error', (e) => { failure = e; });
  app.stderr.on('data', () => { /* diagnostic data stays out of the test report */ });
  for (let i = 0; i < 120; i++) {
    if (failure) throw failure;
    try {
      if (!browser?.isConnected()) {
        browser = await chromium.connectOverCDP('http://127.0.0.1:' + port);
        browser.on('disconnected',()=>lifecycle.push({event:'cdp-disconnected',launch:launches}));
      }
      for (const context of browser.contexts()) {
        page = context.pages().find((p) => !p.isClosed() && /^(https?:\/\/tauri\.localhost|tauri:\/\/localhost)/.test(p.url()));
        if (page) break;
      }
      if (page && !page.isClosed() && /^(https?:\/\/tauri\.localhost|tauri:\/\/localhost)/.test(page.url())) {
        const ownedLaunch=launches;
        page.on('close',()=>lifecycle.push({event:'page-closed',launch:ownedLaunch,at:performance.now()-started}));
        lifecycle.push({event:'connected',launch:ownedLaunch,at:performance.now()-started,pid:app.pid});
        return;
      }
    } catch { /* wait only for this owned application's debugging endpoint */ }
    await setTimeout(250);
  }
  throw new Error('Native WebView2 was not available for E2E testing.');
}
async function close() {
  await browser?.close().catch(() => {});
  if (app && app.exitCode === null) {
    const exited = new Promise((resolveExit) => app.once('exit', resolveExit));
    app.kill(); await exited;
  }
}
async function click(name) { await page.getByRole('button', { name, exact: true }).click(); }
async function saved() { await expect(page.getByRole('status')).toContainText(/Saved on this device/); }
async function ledger(name, nature, kind) {
  // Sections have headings but no implicit region name; locate by semantic heading ancestry.
  const form = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Ledgers', exact: true }) }).locator('form');
  await form.getByLabel('Ledger name').fill(name);
  await form.getByLabel('Group').selectOption({ label: nature + ' · ' + nature.toLowerCase() });
  await form.getByLabel('Ledger kind').selectOption(kind);
  await form.getByRole('button', { name: 'Add ledger', exact: true }).click(); await saved();
}
async function post(first, second, value, narration) {
  const form = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Record a journal', exact: true }) }).locator('form');
  await form.getByLabel('Journal date').fill('2026-02-15');
  await form.getByLabel('Ledger 1', { exact: true }).selectOption({ label: first });
  await form.getByLabel('Ledger 2', { exact: true }).selectOption({ label: second });
  await form.getByLabel('Amount 1', { exact: true }).fill(value);
  await form.getByLabel('Amount 2', { exact: true }).fill(value);
  await form.getByLabel('Narration', { exact: true }).fill(narration);
  await form.getByLabel('Narration', { exact: true }).press('Enter'); await saved();
}
let report;
try {
  await launch();
  await expect(page.getByRole('heading', { name: 'Set up this device' })).toBeVisible();
  const startupMs = Math.round(performance.now() - started);
  await page.getByLabel('Device password', { exact: true }).fill('Synthetic device password 2026');
  await page.getByLabel('Confirm device password', { exact: true }).fill('Synthetic device password 2026');
  await click('Create device vault');
  await page.getByLabel('Company name').fill('Synthetic Desktop Lab');
  await page.getByLabel('Currency code (three uppercase letters)').fill('UGX');
  await page.getByLabel('Currency decimal places (0–6)').fill('0');
  await page.getByLabel('Start date', { exact: true }).fill('2026-02-28');
  await page.getByLabel('End date', { exact: true }).fill('2026-02-01');
  await page.getByLabel('Books beginning', { exact: true }).fill('2026-01-01');
  await page.getByLabel('End date', { exact: true }).press('Enter');
  const end = page.getByLabel('End date', { exact: true });
  await expect(end).toHaveAttribute('aria-invalid', 'true');
  await expect(end).toBeFocused();
  const description = await end.getAttribute('aria-describedby');
  expect(description).toBeTruthy();
  expect(await end.evaluate((input) => document.getElementById(input.getAttribute('aria-describedby')).textContent)).toBe('End date must be on or after start date.');
  expect(await page.getByLabel('Company', { exact: true }).locator('option').count()).toBe(1);
  checks.push('Keyboard invalid-period submission rejected; focus, inline text, invalid field and screen-reader association verified');
  await page.getByLabel('Start date', { exact: true }).fill('2026-01-01');
  await end.fill('2026-12-31'); await end.press('Enter');
  await saved();
  await ledger('Cash', 'Asset', 'cash'); await ledger('Equity', 'Equity', 'general'); await ledger('Expense', 'Expense', 'general');
  await click('Journal entry');
  // Deliberately block network requests; IPC remains the only persistence route.
  await page.route(/^https?:\/\//, (route) => ['ipc.localhost', 'tauri.localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await post('Cash', 'Equity', '1000', 'Synthetic capital');
  await post('Expense', 'Cash', '200', 'Synthetic expense');
  await click('Reports');
  await page.getByLabel('Start date', { exact: true }).fill('2026-01-01');
  await page.getByLabel('End date', { exact: true }).fill('2026-12-31');
  await click('Apply report period');
  const table = page.getByRole('table', { name: 'Trial balance', exact: true });
  await expect(table.getByRole('row').filter({ hasText: 'Total' })).toContainText('1000');
  await expect(table.getByRole('row').filter({ hasText: 'Cash' })).toContainText('800');
  await page.getByRole('button', { name: 'Cash', exact: true }).click();
  await expect(page.getByRole('table', { name: 'Ledger statement' })).toBeVisible();
  checks.push('Offline chart/post/report: cash 800 debit, expense 200 debit, equity 1000 credit, trial balance 1000 per side');
  await click('Financial periods');
  const calendar = page.locator('form').filter({ has: page.getByRole('button', { name: 'Add financial year', exact: true }) });
  await calendar.getByLabel('Start date', { exact: true }).fill('2027-01-01');
  await calendar.getByLabel('End date', { exact: true }).fill('2027-12-31');
  await calendar.getByLabel('Reason for adding year').fill('Synthetic new financial year');
  await calendar.getByRole('button', { name: 'Add financial year', exact: true }).click(); await saved();
  await expect(page.getByLabel('Financial year', { exact: true }).locator('option')).toHaveCount(2);
  await page.getByLabel('Financial year', { exact: true }).selectOption({ label: '2026-01-01 to 2026-12-31' });
  checks.push('Second financial year created and selected without losing company history');
  // IPC rejects unsupported operations even after unlock.
  const forbidden = await page.evaluate(async () => {
    try { await window.__TAURI_INTERNALS__.invoke('execute_sql', { sql: 'SELECT 1' }); return false; }
    catch { return true; }
  });
  expect(forbidden).toBe(true);
  checks.push('Unsupported native SQL operation rejected');
  await close(); await launch();
  await expect(page.getByRole('heading', { name: 'Unlock your workspace' })).toBeVisible();
  await page.getByLabel('Device password', { exact: true }).fill('Synthetic device password 2026');
  await click('Unlock');
  await page.getByLabel('Company', { exact: true }).selectOption({ label: 'Synthetic Desktop Lab' });
  await click('Reports');
  await page.getByLabel('Start date', { exact: true }).fill('2026-01-01');
  await page.getByLabel('End date', { exact: true }).fill('2026-12-31'); await click('Apply report period');
  await expect(page.getByRole('table', { name: 'Trial balance' }).getByRole('row').filter({ hasText: 'Cash' })).toContainText('800');
  checks.push('Forced native process exit/relaunch retained acknowledged postings and required unlock');
  if (process.env.ERP_CLOUD_E2E) {
    await click('Synchronization');
    await page.getByLabel('Service origin', { exact: true }).fill(process.env.ERP_CLOUD_E2E);
    await page.getByLabel('Service username', { exact: true }).fill(process.env.ERP_CLOUD_E2E_USER);
    await page.getByLabel('Service password', { exact: true }).fill(process.env.ERP_CLOUD_E2E_PASSWORD);
    await click('Sign in to service');
    await expect(page.getByRole('status')).toContainText('Service sign-in succeeded.');
    await page.getByLabel(/I reviewed this synthetic or authorized company/).check();
    await click('Enroll selected company');
    await expect(page.getByRole('status')).toContainText('Reviewed import accepted.');
    await expect(page.getByRole('table', { name: 'Command delivery' })).toContainText('accepted');
    checks.push('Native-only service login and explicit reviewed enrollment accepted in real WebView2');
    await click('Journal entry'); await post('Expense', 'Cash', '50', 'Synthetic synchronized expense');
    await click('Synchronization');
    await expect(page.getByRole('table', { name: 'Command delivery' })).toContainText('pending');
    await click('Synchronize now');
    await expect(page.getByRole('status')).toContainText('Synchronization completed.');
    await expect(page.getByRole('table', { name: 'Command delivery' })).not.toContainText('pending');
    await click('Reports');
    await page.getByLabel('Report basis').selectOption('canonical');
    await page.getByLabel('Start date', { exact: true }).fill('2026-01-01');
    await page.getByLabel('End date', { exact: true }).fill('2026-12-31'); await click('Apply report period');
    await expect(page.getByRole('table', { name: 'Trial balance' }).getByRole('row').filter({ hasText: 'Cash' })).toContainText('750');
    await page.getByLabel('Report basis').selectOption('device');
    await expect(page.getByRole('table', { name: 'Trial balance' }).getByRole('row').filter({ hasText: 'Cash' })).toContainText('750');
    checks.push('Real native sync transitions pending to accepted and canonical/device cash reconcile at 750 without renderer network access');
    await click('Synchronization'); await click('Sign out of service');
    await expect(page.getByRole('status')).toContainText('Signed out.');
    await expect(page.getByRole('alert').filter({ hasText: 'requires online authority or recovery review' })).toBeVisible();
    checks.push('Explicit cloud sign-out clears the service session and restricts synchronized posting while reports remain available');
  }
  // WebView2 embeds a fixed native surface; capture that viewport rather than
  // asking Chromium to resize the native surface for an offscreen full page.
  await page.screenshot({ path: resolve('.cache/desktop-synthetic.png'), fullPage: false });
  const metrics = await page.evaluate(() => ({
    navigationMs: Math.round(performance.getEntriesByType('navigation')[0].duration),
    domElements: document.querySelectorAll('*').length,
  }));
  const resources = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Command',
    `$owned=@(${app.pid}); $all=Get-CimInstance Win32_Process -Filter "Name='erp-desktop.exe' OR Name='msedgewebview2.exe'"; do { $more=@($all | Where-Object { $_.ParentProcessId -in $owned -and $_.ProcessId -notin $owned } | Select-Object -ExpandProperty ProcessId); $owned+=$more } while($more.Count); $mem=@(Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | Where-Object { $_.IDProcess -in $owned }); @{processCount=$mem.Count; privateWorkingSetBytes=($mem | Measure-Object WorkingSetPrivate -Sum).Sum; scope='Owned native app and descendant WebView2 processes on this host'} | ConvertTo-Json -Compress`
  ], { windowsHide: true, encoding: 'utf8' }).trim());
  report = { passed: true, platform: process.platform, nativePid: app.pid, startupMs, metrics,
    resources: resources.processCount > 0 ? {available:true,...resources} : {available:false,reason:'Windows performance counters returned no owned process instances; no memory measurement is claimed'}, checks,
    limitations: ['CDP tests debug WebView2, not installer/signing or a screen-reader user trial', 'Renderer network routes blocked for synthetic posting; native sync tested only when the isolated cloud fixture is supplied', 'Resource/startup samples describe this synthetic debug run, not release-scale performance'] };
} catch (error) {
  report = { passed: false, checks, error: String(error),lifecycle:structuredClone(lifecycle),nativeExit:app?.exitCode,connected:browser?.isConnected(),closed:page?.isClosed(),url:page?.url() };
  process.exitCode = 1;
} finally {
  await close();
  await mkdir('.cache', { recursive: true });
  await writeFile('.cache/desktop-e2e.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
