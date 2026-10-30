import { expect, test } from 'vitest';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AccountingError, trialBalance } from '@erp/domain';
import type { Scope } from '@erp/domain';
import { AccountingService } from '@erp/application';
import type { Principal } from '@erp/application';
import { configuration, journal } from '../../../packages/domain/test/fixtures.js';
import { DesktopBookStore } from '../src/store.js';
import { harness } from './native-harness.js';
import type { Native } from '../src/store.js';

const password = 'Synthetic vault password 2026';
const passphrase = 'Synthetic backup phrase 2026';
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'erp-synthetic-'));
  const path = join(directory, 'accounting.sqlite');
  const host = harness(path);
  const auth = await host.native<{ token: string; tenantId: string }>('setup', { password });
  host.setToken(auth.token);
  const scope: Scope = { tenantId: auth.tenantId, companyId: 'company-a' };
  const base = configuration();
  const config = configuration({
    company: { ...base.company, ...scope },
    years: base.years.map((v) => ({ ...v, ...scope })),
    periods: base.periods.map((v) => ({ ...v, ...scope })),
    groups: base.groups.map((v) => ({ ...v, ...scope })),
    ledgers: base.ledgers.map((v) => ({ ...v, ...scope })),
  });
  const store = new DesktopBookStore(host.native); await store.register(config);
  const actor: Principal = { ...scope, actorId: 'local-owner', permissions: ['read', 'post', 'reverse', 'draft', 'manage-chart', 'manage-periods', 'reopen-period'] };
  const service = new AccountingService(store, () => '2026-01-15T12:00:00.000Z');
  const post = () => service.post(actor, { kind: 'post', commandId: 'post-1', expectedChartVersion: 1, journal: journal({ ...scope }) });
  return { directory, path, host, scope, config, store, actor, service, post };
}

test('durable exact posting, duplicate prevention, outbox and cross-process restart reconcile', async () => {
  const f = await fixture();
  const other = harness(f.path);
  const login = await other.native<{ token: string }>('unlock', { password }); other.setToken(login.token);
  const secondService = new AccountingService(new DesktopBookStore(other.native), () => '2026-01-15T12:00:00.000Z');
  const results = await Promise.all([
    ...Array.from({ length: 4 }, () => f.post()),
    ...Array.from({ length: 4 }, () => secondService.post(f.actor, { kind: 'post', commandId: 'post-1', expectedChartVersion: 1, journal: journal({ ...f.scope }) })),
  ]);
  expect(results.every((r) => r.id === 'j1')).toBe(true);
  await f.host.close(); await other.close();
  const reopened = harness(f.path);
  const auth = await reopened.native<{ token: string }>('unlock', { password }); reopened.setToken(auth.token);
  const state = await new DesktopBookStore(reopened.native).read(f.scope);
  expect(state.entries).toHaveLength(1); expect(state.receipts).toHaveLength(1); expect(state.audit).toHaveLength(1);
  expect(state.entries[0]?.lines[0]?.amount).toBe(1000n);
  expect(trialBalance(state.config, state.entries, '2026-01-31').debit).toBe(1000n);
});

test('two valid companies keep independent charts, journals, receipts and balances', async () => {
  const f = await fixture(); await f.post();
  const scope = { ...f.scope, companyId: 'company-b' };
  const b = f.config;
  await f.store.register({
    company: { ...b.company, ...scope, name: 'Second synthetic company' },
    years: b.years.map((v) => ({ ...v, ...scope })), periods: b.periods.map((v) => ({ ...v, ...scope })),
    groups: b.groups.map((v) => ({ ...v, ...scope })), ledgers: b.ledgers.map((v) => ({ ...v, ...scope })),
  });
  expect((await f.store.read(scope)).entries).toHaveLength(0);
  expect((await f.store.read(f.scope)).entries).toHaveLength(1);
  await expect(f.service.post({ ...f.actor, ...scope }, { kind: 'post', commandId: 'foreign-1', expectedChartVersion: 1,
    journal: journal({ ...f.scope, id: 'foreign-journal' }) })).rejects.toMatchObject({ code: 'SCOPE_MISMATCH' });
  expect(trialBalance((await f.store.read(scope)).config, [], '2026-12-31').debit).toBe(0n);
});

test('financial-year extension is durable, audited, idempotent and rejects overlap atomically', async () => {
  const f = await fixture(); await f.post();
  const year = { ...f.scope, id: 'fy27', start: '2027-01-01', end: '2027-12-31' };
  const command = { kind: 'extend-calendar' as const, commandId: 'add-year', expectedChartVersion: 1, year,
    period: { ...year, id: 'p27', yearId: year.id, status: 'open' as const, version: 1 }, reason: 'New synthetic year' };
  await f.service.extendCalendar(f.actor, command); await f.service.extendCalendar(f.actor, command);
  const state = await f.store.read(f.scope);
  expect(state.config.years).toHaveLength(2); expect(state.entries).toHaveLength(1);
  expect(state.audit.at(-1)?.reason).toBe('New synthetic year');
  await expect(f.service.extendCalendar(f.actor, { ...command, commandId: 'overlap-year',
    year: { ...year, id: 'overlap' }, period: { ...command.period, id: 'overlap-p', yearId: 'overlap' } })).rejects.toMatchObject({ code: 'OVERLAPPING_PERIODS' });
  expect((await f.store.read(f.scope)).config.years).toHaveLength(2);
  await expect(f.service.extendCalendar({ ...f.actor, permissions: ['read'] }, { ...command, commandId: 'denied-year' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
});

test('native SQLite preserves int64-max lines and wider totals beyond JavaScript safe integers', async () => {
  const f = await fixture(); const maximum = (1n << 63n) - 1n;
  await f.service.post(f.actor, { kind: 'post', commandId: 'wide-money', expectedChartVersion: 1,
    journal: journal({ ...f.scope, lines: [
      { ledgerId: 'cash', side: 'debit', amount: maximum }, { ledgerId: 'cash', side: 'debit', amount: maximum },
      { ledgerId: 'equity', side: 'credit', amount: maximum }, { ledgerId: 'equity', side: 'credit', amount: maximum },
    ] }) });
  await f.host.close();
  const reopened = harness(f.path); const login = await reopened.native<{ token: string }>('unlock', { password }); reopened.setToken(login.token);
  const state = await new DesktopBookStore(reopened.native).read(f.scope);
  expect(state.entries[0]?.lines[0]?.amount).toBe(maximum);
  expect(trialBalance(state.config, state.entries, '2026-01-31').debit).toBe(2n * maximum);
});

test('full reversal persists without changing original and respects locked periods', async () => {
  const f = await fixture(); const original = await f.post();
  await f.service.reverse(f.actor, { kind: 'reverse', commandId: 'reverse-1', originalId: original.id, expectedChartVersion: 1,
    journal: { ...f.scope, id: 'reverse-j1', date: '2026-01-16', periodId: 'jan', expectedPeriodVersion: 1, narration: 'Synthetic correction' } });
  let state = await f.store.read(f.scope);
  expect(state.entries[0]).toEqual(original);
  expect(trialBalance(state.config, state.entries, '2026-01-31').debit).toBe(0n);
  await f.service.setPeriodStatus(f.actor, { kind: 'period-status', commandId: 'lock-jan', periodId: 'jan', expectedVersion: 1, status: 'locked', reason: 'Synthetic close' });
  await expect(f.service.post(f.actor, { kind: 'post', commandId: 'post-2', expectedChartVersion: 1, journal: journal({ ...f.scope, id: 'j2' }) })).rejects.toMatchObject({ code: 'PERIOD_LOCKED' });
  state = await f.store.read(f.scope); expect(state.entries).toHaveLength(2);
});

test('a lost acknowledgment is confirmed by immutable receipt without reposting', async () => {
  const f = await fixture();
  let dropped = false;
  const unreliable: Native = async <T>(operation: string, payload?: Record<string, unknown>): Promise<T> => {
    const result = await f.host.native<T>(operation, payload);
    if (operation === 'commit_book' && !dropped) { dropped = true; throw new Error('Synthetic lost acknowledgment'); }
    return result;
  };
  const service = new AccountingService(new DesktopBookStore(unreliable), () => '2026-01-15T12:00:00.000Z');
  expect((await service.post(f.actor, { kind: 'post', commandId: 'ack-1', expectedChartVersion: 1, journal: journal({ ...f.scope }) })).id).toBe('j1');
  expect((await f.store.read(f.scope)).entries).toHaveLength(1);
});

test('record a small-book 20-line durable posting baseline and reconcile all samples', async () => {
  const f = await fixture(); const samples: number[] = [];
  const lines = Array.from({ length: 20 }, (_, i) => ({
    ledgerId: i < 10 ? 'cash' : 'equity', side: i < 10 ? 'debit' as const : 'credit' as const, amount: 10n,
  }));
  for (let i = 0; i < 20; i++) {
    const start = performance.now();
    await f.service.post(f.actor, { kind: 'post', commandId: 'bench-' + i, expectedChartVersion: 1, journal: journal({ ...f.scope, id: 'bench-j-' + i, lines }) });
    samples.push(performance.now() - start);
  }
  const state = await f.store.read(f.scope); expect(state.entries).toHaveLength(20);
  expect(trialBalance(state.config, state.entries, '2026-01-31').debit).toBe(2000n);
  const sorted = [...samples].sort((a, b) => a - b);
  await mkdir('.cache', { recursive: true });
  await writeFile('.cache/posting-baseline.json', JSON.stringify({ samples: 20, linesPerPosting: 20, finalLines: 400,
    p50Ms: Math.round(sorted[9]!), p95Ms: Math.round(sorted[18]!), maximumMs: Math.round(sorted[19]!),
    scope: 'Shared TypeScript service + native SQLite harness, small growing synthetic book; no release-scale claim' }, null, 2) + '\n');
});

test('native boundary rejects forged scope, imbalance, inverted periods, immutable edits and missing audit', async () => {
  const f = await fixture(); await f.post();
  const snapshot = await f.host.native<{ state: string; revision: number }>('read_book', { companyId: f.scope.companyId });
  const state = JSON.parse(snapshot.state) as Record<string, unknown>;
  const changes: [string[], unknown][] = [
    [['config', 'company', 'tenantId'], 'foreign'],
    [['entries', '0', 'lines', '0', 'amount'], '999'],
    [['config', 'periods', '0', 'end'], '2025-12-31'],
    [['entries', '0', 'narration'], 'Destructive edit'],
    [['audit'], []],
  ];
  for (const [path, value] of changes) {
    const changed = structuredClone(state);
    const target = path.slice(0, -1).reduce<Record<string, unknown>>((row, key) => row[key] as Record<string, unknown>, changed);
    target[path.at(-1)!] = value;
    await expect(f.host.native('commit_book', { companyId: f.scope.companyId, revision: snapshot.revision, state: JSON.stringify(changed) })).rejects.toBeInstanceOf(AccountingError);
    expect((await f.host.native<{ state: string }>('read_book', { companyId: f.scope.companyId })).state).toBe(snapshot.state);
  }
  await expect(f.store.read({ ...f.scope, tenantId: 'foreign' })).rejects.toMatchObject({ code: 'SCOPE_MISMATCH' });
  await expect(f.host.native('read_book', { companyId: 'missing' })).rejects.toMatchObject({ code: 'BOOK_NOT_FOUND' });
});

test('killing a process inside an uncommitted write recovers the last acknowledged state', async () => {
  const f = await fixture(); await f.post();
  const before = await f.host.native('read_book', { companyId: f.scope.companyId });
  await expect(f.host.native('crash_write')).rejects.toThrow();
  const reopened = harness(f.path); const auth = await reopened.native<{ token: string }>('unlock', { password }); reopened.setToken(auth.token);
  expect(await reopened.native('read_book', { companyId: f.scope.companyId })).toEqual(before);
});

test('encrypted backup restores a consistent snapshot; wrong key and tampering leave current records unchanged', async () => {
  const f = await fixture(); await f.post();
  const path = join(f.directory, 'snapshot.erpbackup');
  await f.host.native('backup_file', { path, passphrase });
  const other = harness(f.path);
  const login = await other.native<{ token: string }>('unlock', { password }); other.setToken(login.token);
  const file = await readFile(path); expect(file.includes(Buffer.from('Synthetic Engine Lab'))).toBe(false);
  await f.service.setPeriodStatus(f.actor, { kind: 'period-status', commandId: 'lock-1', periodId: 'jan', status: 'locked', expectedVersion: 1, reason: 'After backup' });
  const current = await f.host.native('read_book', { companyId: f.scope.companyId });
  await expect(f.host.native('restore_file', { path, passphrase: 'Different wrong passphrase' })).rejects.toMatchObject({ code: 'BACKUP_AUTH_FAILED' });
  expect(await f.host.native('read_book', { companyId: f.scope.companyId })).toEqual(current);
  const corrupt = join(f.directory, 'tampered.erpbackup'); file[file.length - 1] = file[file.length - 1]! ^ 1; await writeFile(corrupt, file);
  await expect(f.host.native('restore_file', { path: corrupt, passphrase })).rejects.toMatchObject({ code: 'BACKUP_AUTH_FAILED' });
  expect(await f.host.native('read_book', { companyId: f.scope.companyId })).toEqual(current);
  await f.host.native('restore_file', { path, passphrase });
  await expect(other.native('read_book', { companyId: f.scope.companyId })).rejects.toMatchObject({ code: 'SESSION_LOCKED' });
  await other.close();
  await expect(f.host.native('read_book', { companyId: f.scope.companyId })).rejects.toMatchObject({ code: 'SESSION_LOCKED' });
  const auth = await f.host.native<{ token: string }>('unlock', { password }); f.host.setToken(auth.token);
  const restored = await f.store.read(f.scope); expect(restored.entries).toHaveLength(1); expect(restored.receipts).toHaveLength(1);
  expect(restored.config.periods[0]?.status).toBe('open');
});

test('local vault enforces credentials and lock independently of renderer permissions', async () => {
  const f = await fixture(); await f.host.native('lock');
  await expect(f.host.native('list_books')).rejects.toMatchObject({ code: 'SESSION_LOCKED' });
  await expect(f.host.native('unlock', { password: 'wrong password' })).rejects.toMatchObject({ code: 'UNLOCK_FAILED' });
  await expect(f.host.native('unlock', { password })).rejects.toMatchObject({ code: 'UNLOCK_DELAY' });
});

test('SQLite disk-full rolls back all company, receipt and audit effects', async () => {
  const f = await fixture();
  await f.host.native('disk_limit');
  const before = await f.host.native('read_book', { companyId: f.scope.companyId });
  // A valid wide posting exceeds the deliberately constrained synthetic DB page limit.
  const lines = Array.from({ length: 1000 }, (_, i) => ({
    ledgerId: i < 500 ? 'cash' : 'equity', side: i < 500 ? 'debit' as const : 'credit' as const, amount: 1n,
  }));
  await expect(f.service.post(f.actor, { kind: 'post', commandId: 'disk-fault', expectedChartVersion: 1,
    journal: journal({ ...f.scope, lines }) })).rejects.toMatchObject({ code: 'DISK_FULL' });
  expect(await f.host.native('read_book', { companyId: f.scope.companyId })).toEqual(before);
});
