import { describe, expect, it } from 'vitest';
import { AccountingService, InMemoryBookStore } from '../src/index.js';
import type { PostCommand, Principal, SaveDraftCommand } from '../src/index.js';
import { AccountingError, defineBook, trialBalance } from '@erp/domain';
import { at, configuration, journal, scope } from '../../domain/test/fixtures.js';

const principal: Principal = { ...scope, actorId: 'accountant', permissions: ['read', 'post', 'reverse', 'draft', 'manage-chart', 'manage-periods', 'reopen-period'] };
const command = (id = 'j1'): PostCommand => ({ kind: 'post', commandId: `cmd-${id}`, expectedChartVersion: 1, journal: journal({ id }) });
function setup() {
  const store = new InMemoryBookStore(); store.register(configuration());
  return { store, service: new AccountingService(store, () => at) };
}
const draftCommand = (id = 'd1'): SaveDraftCommand => ({ kind: 'save-draft', commandId: `save-${id}`, expectedChartVersion: 1, expectedDraftVersion: null, draft: journal({ id }) });

describe('transactional financial command contract', () => {
  it('rejects cyclic command data with a structured error before any effects', async () => {
    const { service } = setup();
    const cyclic = command() as PostCommand & { cycle?: unknown }; cyclic.cycle = cyclic;
    await expect(service.post(principal, cyclic)).rejects.toMatchObject({ code: 'INVALID_PAYLOAD' });
    expect((await service.snapshot(principal)).receipts).toEqual([]);
  });
  it('permits only one of simultaneous same-ID/different-payload requests', async () => {
    const { service } = setup();
    const outcomes = await Promise.allSettled([service.post(principal, command()), service.post(principal, { ...command(), journal: journal({ narration: 'Different payload' }) })]);
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect((await service.snapshot(principal)).entries).toHaveLength(1);
  });
  it('commits immutable posting, receipt and audit together; same command returns original result', async () => {
    const { service } = setup(); const first = await service.post(principal, command());
    const repeated = await service.post(principal, command());
    expect(repeated).toEqual(first); expect(Object.isFrozen(repeated.lines)).toBe(true);
    const state = await service.snapshot(principal);
    expect(state.entries).toHaveLength(1); expect(state.receipts).toHaveLength(1); expect(state.audit).toHaveLength(1);
    expect(state.audit[0]).toMatchObject({ actorId: 'accountant', action: 'post', at });
    expect(state.receipts[0]?.payload).toContain('b:1000');
    expect(Reflect.set(state.entries[0]!, 'date', '2025-01-01')).toBe(false);
  });
  it('serializes 100 simultaneous duplicate commands without duplicate effects', async () => {
    const { service } = setup(); const results = await Promise.all(Array.from({ length: 100 }, () => service.post(principal, command())));
    expect(results.every((row) => row.id === 'j1')).toBe(true);
    const state = await service.snapshot(principal);
    expect(state.entries).toHaveLength(1); expect(state.audit).toHaveLength(1);
  });
  it('rejects same ID with altered content or actor, but ignores property order', async () => {
    const { service } = setup(); await service.post(principal, command());
    const same = command();
    await expect(service.post(principal, { journal: { ...same.journal }, expectedChartVersion: 1, commandId: same.commandId, kind: 'post' })).resolves.toMatchObject({ id: 'j1' });
    await expect(service.post(principal, { ...same, journal: { ...same.journal, narration: 'Different' } })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    await expect(service.post({ ...principal, actorId: 'another' }, same)).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });
  it('rolls back all effects on commit failure and permits a safe same-ID retry', async () => {
    const { store, service } = setup(); store.failNextCommit();
    await expect(service.post(principal, command())).rejects.toMatchObject({ code: 'SYNTHETIC_COMMIT_FAILURE' });
    const failed = await service.snapshot(principal);
    expect(failed.entries).toEqual([]); expect(failed.receipts).toEqual([]); expect(failed.audit).toEqual([]);
    await service.post(principal, command()); expect((await service.snapshot(principal)).entries).toHaveLength(1);
  });
  it('does not publish a duplicate journal under a new command ID', async () => {
    const { service } = setup(); await service.post(principal, command());
    await expect(service.post(principal, { ...command(), commandId: 'different' })).rejects.toMatchObject({ code: 'DUPLICATE_JOURNAL' });
    expect((await service.snapshot(principal)).receipts).toHaveLength(1);
  });
  it('rejects invalid financial writes without leaving a receipt or audit', async () => {
    const { service } = setup();
    await expect(service.post(principal, { ...command(), journal: journal({ lines: [{ ledgerId: 'cash', side: 'debit', amount: 1n }] }) })).rejects.toBeInstanceOf(AccountingError);
    const state = await service.snapshot(principal);
    expect(state.entries).toEqual([]); expect(state.receipts).toEqual([]); expect(state.audit).toEqual([]);
  });
  it('captures input before transaction queues; callers cannot change an in-flight amount', async () => {
    const { service } = setup(); const mutable = structuredClone(command());
    const pending = service.post(principal, mutable);
    Object.assign(mutable.journal.lines[0]!, { amount: 1n });
    expect((await pending).lines[0]?.amount).toBe(1000n);
  });
});

describe('tenant/company and permission boundaries', () => {
  it.each(['tenantId', 'companyId'] as const)('rejects cross-%s commands and reads', async (field) => {
    const { service } = setup();
    await expect(service.post(principal, { ...command(), journal: journal({ [field]: 'foreign' }) })).rejects.toMatchObject({ code: 'SCOPE_MISMATCH' });
    await expect(service.snapshot({ ...principal, [field]: 'foreign' })).rejects.toMatchObject({ code: 'BOOK_NOT_FOUND' });
  });
  it('isolates identical IDs and command IDs across distinct tenants', async () => {
    const { store, service } = setup(); const foreign = { ...principal, tenantId: 'tenant-b' };
    const book = configuration();
    store.register(defineBook({ company: { ...book.company, tenantId: 'tenant-b' },
      years: book.years.map((row) => ({ ...row, tenantId: 'tenant-b' })),
      periods: book.periods.map((row) => ({ ...row, tenantId: 'tenant-b' })),
      groups: book.groups.map((row) => ({ ...row, tenantId: 'tenant-b' })),
      ledgers: book.ledgers.map((row) => ({ ...row, tenantId: 'tenant-b' })),
    }));
    await service.post(principal, command());
    await service.post(foreign, { ...command(), journal: journal({ tenantId: 'tenant-b' }) });
    expect((await service.snapshot(principal)).entries).toHaveLength(1);
    expect((await service.snapshot(foreign)).entries[0]?.tenantId).toBe('tenant-b');
  });
  it('authorizes before receipt lookup and requires read permission for snapshots', async () => {
    const { service } = setup(); await service.post(principal, command());
    await expect(service.post({ ...principal, permissions: ['read'] }, command())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.snapshot({ ...principal, permissions: ['post'] })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.post({ ...principal, permissions: 'post' as unknown as Principal['permissions'] }, command())).rejects.toMatchObject({ code: 'INVALID_PRINCIPAL' });
  });
});

describe('period locking, stale versions and reversals', () => {
  it('serializes period close before posting and rejects stale versions after reopen', async () => {
    const { service } = setup();
    const close = service.setPeriodStatus(principal, { kind: 'period-status', commandId: 'lock', periodId: 'jan', expectedVersion: 1, status: 'locked', reason: 'Month closed' });
    const posting = service.post(principal, command());
    await expect(close).resolves.toMatchObject({ status: 'locked', version: 2 });
    await expect(posting).rejects.toMatchObject({ code: 'PERIOD_LOCKED' });
    await service.setPeriodStatus(principal, { kind: 'period-status', commandId: 'open', periodId: 'jan', expectedVersion: 2, status: 'open', reason: 'Authorized reopening' });
    await expect(service.post(principal, command())).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    await service.post(principal, { ...command(), journal: journal({ expectedPeriodVersion: 3 }) });
  });
  it('keeps a completed posting when its period closes, including idempotent retry', async () => {
    const { service } = setup(); const first = await service.post(principal, command());
    await service.setPeriodStatus(principal, { kind: 'period-status', commandId: 'close', periodId: 'jan', expectedVersion: 1, status: 'locked', reason: 'Close' });
    await expect(service.post(principal, command())).resolves.toEqual(first);
    const state = await service.snapshot(principal);
    expect(trialBalance(state.config, state.entries, '2026-01-31').debit).toBe(1000n);
  });
  it('requires separate reopening rights and audit reason', async () => {
    const { service } = setup();
    await expect(service.setPeriodStatus({ ...principal, permissions: ['manage-periods'] }, { kind: 'period-status', commandId: 'open', periodId: 'jan', expectedVersion: 1, status: 'open', reason: 'Reopen' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.setPeriodStatus(principal, { kind: 'period-status', commandId: 'close', periodId: 'jan', expectedVersion: 1, status: 'locked', reason: '' })).rejects.toMatchObject({ code: 'REASON_REQUIRED' });
  });
  it('reverses once in an open later period and rejects duplicate full reversals', async () => {
    const { service } = setup(); await service.post(principal, command());
    await service.setPeriodStatus(principal, { kind: 'period-status', commandId: 'close', periodId: 'jan', expectedVersion: 1, status: 'locked', reason: 'Close original period' });
    const reversal = { kind: 'reverse' as const, commandId: 'reverse', originalId: 'j1', expectedChartVersion: 1,
      journal: { ...journal(), id: 'r1', date: '2026-02-01', periodId: 'feb', narration: 'Correct original' } };
    const result = await service.reverse(principal, reversal);
    expect(result.reverses).toBe('j1');
    await expect(service.reverse(principal, reversal)).resolves.toEqual(result);
    await expect(service.reverse(principal, { ...reversal, commandId: 'reverse-again', journal: { ...reversal.journal, id: 'r2' } })).rejects.toMatchObject({ code: 'ALREADY_REVERSED' });
    const state = await service.snapshot(principal);
    expect(state.entries).toHaveLength(2); expect(trialBalance(state.config, state.entries, '2026-02-28').debit).toBe(0n);
    expect(state.entries[0]?.lines[0]?.side).toBe('debit');
  });
});

describe('draft vouchers and master invariants', () => {
  it('does not advance the chart revision for a no-op, but rejects a competing stale update', async () => {
    const { service } = setup(); const book = configuration();
    await service.replaceChart(principal, { kind: 'replace-chart', commandId: 'noop', expectedChartVersion: 1, groups: book.groups, ledgers: book.ledgers });
    expect((await service.snapshot(principal)).chartVersion).toBe(1);
    const outcomes = await Promise.allSettled(['a', 'b'].map((suffix) => service.replaceChart(principal, { kind: 'replace-chart', commandId: `chart-${suffix}`, expectedChartVersion: 1, groups: book.groups, ledgers: book.ledgers.map((row) => ({ ...row, name: `${row.name}-${suffix}` })) })));
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect((await service.snapshot(principal)).chartVersion).toBe(2);
  });
  it('saves unbalanced drafts without affecting reports and rejects posting until corrected', async () => {
    const { service } = setup(); const draft = { ...draftCommand(), draft: journal({ id: 'd1', lines: [{ ledgerId: 'cash', side: 'debit' as const, amount: 1n }] }) };
    await service.saveDraft(principal, draft);
    await expect(service.postDraft(principal, { kind: 'post-draft', commandId: 'post', draftId: 'd1', entryId: 'j1', expectedDraftVersion: 1, expectedPeriodVersion: 1, expectedChartVersion: 1 })).rejects.toMatchObject({ code: 'INVALID_LINES' });
    expect((await service.snapshot(principal)).entries).toEqual([]);
    await service.saveDraft(principal, { ...draftCommand(), commandId: 'edit', expectedDraftVersion: 1 });
    await service.postDraft(principal, { kind: 'post-draft', commandId: 'post', draftId: 'd1', entryId: 'j1', expectedDraftVersion: 2, expectedPeriodVersion: 1, expectedChartVersion: 1 });
    await expect(service.saveDraft(principal, { ...draftCommand(), commandId: 'tamper', expectedDraftVersion: 3 })).rejects.toMatchObject({ code: 'POSTED_DRAFT_IMMUTABLE' });
    const state = await service.snapshot(principal); expect(state.drafts[0]?.status).toBe('posted'); expect(state.entries).toHaveLength(1);
  });
  it('rejects stale draft edits and makes draft posting/receipt/source update atomic', async () => {
    const { service, store } = setup(); await service.saveDraft(principal, draftCommand());
    await expect(service.saveDraft(principal, { ...draftCommand(), commandId: 'stale' })).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    store.failNextCommit();
    await expect(service.postDraft(principal, { kind: 'post-draft', commandId: 'post', draftId: 'd1', entryId: 'j1', expectedDraftVersion: 1, expectedPeriodVersion: 1, expectedChartVersion: 1 })).rejects.toMatchObject({ code: 'SYNTHETIC_COMMIT_FAILURE' });
    const state = await service.snapshot(principal); expect(state.entries).toEqual([]); expect(state.drafts[0]?.status).toBe('draft'); expect(state.receipts).toHaveLength(1);
  });
  it('rejects stale chart versions and preserves referenced accounting meaning', async () => {
    const { service } = setup(); await service.post(principal, command()); const book = configuration();
    await expect(service.replaceChart(principal, { kind: 'replace-chart', commandId: 'delete', expectedChartVersion: 1, groups: book.groups, ledgers: book.ledgers.filter((row) => row.id !== 'cash') })).rejects.toMatchObject({ code: 'REFERENCED_MASTER_IMMUTABLE' });
    await service.replaceChart(principal, { kind: 'replace-chart', commandId: 'rename', expectedChartVersion: 1, groups: book.groups, ledgers: book.ledgers.map((row) => ({ ...row, name: `Renamed ${row.name}` })) });
    await expect(service.post(principal, command('stale'))).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    await service.post(principal, { ...command('fresh'), expectedChartVersion: 2 });
    const state = await service.snapshot(principal);
    expect(state.entries[0]?.lines[0]?.ledgerName).toBe('Cash');
    expect(state.entries[1]?.lines[0]?.ledgerName).toBe('Renamed Cash');
  });
});

describe('reference adapter persistence-boundary guards', () => {
  it('rejects inverted period configuration at registration and commit without partial changes', async () => {
    const store = new InMemoryBookStore(); const book = configuration();
    const invalid = { ...book, periods: [{ ...book.periods[0]!, start: '2026-02-28', end: '2026-02-01' }] };
    expect(() => store.register(invalid)).toThrow(expect.objectContaining({ code: 'INVALID_PERIOD_RANGE', field: 'endDate' }));
    store.register(book);
    await expect(store.transact(scope, (state) => { state.config = invalid; })).rejects.toMatchObject({ code: 'INVALID_PERIOD_RANGE' });
    expect((await store.read(scope)).config.periods[0]?.start).toBe('2026-01-01');
  });
  it('blocks editing/deleting posted journals, receipts and audit even through the adapter port', async () => {
    const { store, service } = setup(); await service.post(principal, command());
    await expect(store.transact(scope, (state) => { state.entries = []; })).rejects.toMatchObject({ code: 'POSTED_JOURNAL_IMMUTABLE' });
    await expect(store.transact(scope, (state) => { state.entries = state.entries.map((entry) => ({ ...entry, narration: 'Edited' })); })).rejects.toMatchObject({ code: 'POSTED_JOURNAL_IMMUTABLE' });
    await expect(store.transact(scope, (state) => { state.receipts = []; })).rejects.toMatchObject({ code: 'RECEIPT_IMMUTABLE' });
    await expect(store.transact(scope, (state) => { state.audit = []; })).rejects.toMatchObject({ code: 'AUDIT_IMMUTABLE' });
    await expect(store.transact(scope, (state) => { state.config = { ...state.config, periods: state.config.periods.map((period) => period.id === 'jan' ? { ...period, start: '2026-01-02' } : period) }; })).rejects.toMatchObject({ code: 'REFERENCED_PERIOD_IMMUTABLE' });
    const state = await service.snapshot(principal);
    expect(state.entries).toHaveLength(1); expect(state.receipts).toHaveLength(1); expect(state.audit).toHaveLength(1);
  });
  it('rolls back a period lock commit fault including its version, receipt and audit', async () => {
    const { store, service } = setup(); store.failNextCommit();
    await expect(service.setPeriodStatus(principal, { kind: 'period-status', commandId: 'close', periodId: 'jan', expectedVersion: 1, status: 'locked', reason: 'Close' })).rejects.toMatchObject({ code: 'SYNTHETIC_COMMIT_FAILURE' });
    const state = await service.snapshot(principal);
    expect(state.config.periods[0]).toMatchObject({ status: 'open', version: 1 }); expect(state.receipts).toEqual([]); expect(state.audit).toEqual([]);
  });
});
