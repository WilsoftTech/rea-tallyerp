import { describe, expect, it } from 'vitest';
import { AccountingService, InMemoryBookStore, tradeOf, validateCommit } from '../src/index.js';
import type { BookState, PostDocumentCommand, Principal, SavePartyCommand } from '../src/index.js';
import { aging, lineAmount, partyBalances, trialBalance } from '@erp/domain';
import type { DocumentInput } from '@erp/domain';
import { at, configuration, journal, scope } from '../../domain/test/fixtures.js';

const principal: Principal = { ...scope, actorId: 'accountant', permissions: ['read', 'post', 'reverse', 'draft', 'manage-chart', 'manage-periods', 'reopen-period'] };
const party = (id: string, role: 'customer' | 'supplier', overrides: Partial<SavePartyCommand['party']> = {}): SavePartyCommand => ({
  kind: 'save-party', commandId: 'party-' + id, expectedPartyVersion: null, expectedChartVersion: 1,
  party: { ...scope, id, name: id, role, controlLedgerId: role === 'customer' ? 'receivable' : 'payable', creditDays: 30, ...overrides } });
const doc = (id: string, overrides: Partial<DocumentInput> = {}): PostDocumentCommand => ({ kind: 'post-document', commandId: 'doc-' + id, expectedChartVersion: 1,
  document: { ...scope, id, kind: 'sales-invoice', partyId: 'acme', date: '2026-01-10', periodId: 'jan', expectedPeriodVersion: 1, dueDate: null,
    reference: '', narration: '', lines: [{ ledgerId: 'revenue', description: 'Consulting', quantity: '2', unitPrice: 500n }],
    liquidLedgerId: null, amount: null, allocations: [], ...overrides } });
const receipt = (id: string, amount: bigint, allocations: DocumentInput['allocations'] = [], overrides: Partial<DocumentInput> = {}) =>
  doc(id, { kind: 'receipt', lines: [], liquidLedgerId: 'bank', amount, allocations, date: '2026-01-20', ...overrides });
async function setup() {
  const store = new InMemoryBookStore(); store.register(configuration());
  const service = new AccountingService(store, () => at);
  await service.saveParty(principal, party('acme', 'customer'));
  await service.saveParty(principal, party('globex', 'customer', { creditDays: 0 }));
  await service.saveParty(principal, party('supply', 'supplier', { creditDays: 15 }));
  return { store, service };
}
const book = (service: AccountingService) => service.snapshot(principal);

describe('P6-01 party masters, service invoice validation and lifecycle', () => {
  it('validates control ledger nature/kind, credit days, names and company scope', async () => {
    const { service } = await setup();
    await expect(service.saveParty(principal, party('bad', 'customer', { controlLedgerId: 'payable' }))).rejects.toMatchObject({ code: 'INVALID_CONTROL_LEDGER' });
    await expect(service.saveParty(principal, party('bad', 'customer', { controlLedgerId: 'cash' }))).rejects.toMatchObject({ code: 'INVALID_CONTROL_LEDGER' });
    await expect(service.saveParty(principal, party('bad', 'customer', { creditDays: -1 }))).rejects.toMatchObject({ code: 'INVALID_CREDIT_DAYS' });
    await expect(service.saveParty(principal, party('bad', 'customer', { name: ' ACME ' }))).rejects.toMatchObject({ code: 'DUPLICATE_NAME' });
    await expect(service.saveParty(principal, party('bad', 'customer', { companyId: 'company-b' }))).rejects.toMatchObject({ code: 'SCOPE_MISMATCH' });
    expect(await service.saveParty(principal, party('acme', 'customer'))).toMatchObject({ version: 1 }); // same command: idempotent retry
    await expect(service.saveParty(principal, { ...party('acme', 'customer'), commandId: 'duplicate' })).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    const renamed = await service.saveParty(principal, { ...party('acme', 'customer', { name: 'Acme Trading' }), commandId: 'rename', expectedPartyVersion: 1 });
    expect(renamed).toMatchObject({ name: 'Acme Trading', version: 2 });
  });
  it('computes exact rounded line amounts and rejects invalid quantities, prices, dates and ledgers', async () => {
    expect(lineAmount('2.5', 333n)).toBe(833n); // 832.5 rounds half away from zero
    expect(lineAmount('0.125', 4n)).toBe(1n); // 0.5 rounds up
    expect(() => lineAmount('0.0001', 1n)).toThrow(expect.objectContaining({ code: 'INVALID_AMOUNT' }));
    expect(() => lineAmount('1.23456', 1n)).toThrow(expect.objectContaining({ code: 'INVALID_QUANTITY' }));
    const { service } = await setup();
    const line = (overrides: object) => ({ lines: [{ ledgerId: 'revenue', description: 'x', quantity: '1', unitPrice: 1n, ...overrides }] });
    await expect(service.postDocument(principal, doc('i1', line({ quantity: '0' })))).rejects.toMatchObject({ code: 'INVALID_QUANTITY' });
    await expect(service.postDocument(principal, doc('i1', line({ unitPrice: 0n })))).rejects.toMatchObject({ code: 'INVALID_PRICE' });
    await expect(service.postDocument(principal, doc('i1', line({ ledgerId: 'cash' })))).rejects.toMatchObject({ code: 'INVALID_LINE_LEDGER' });
    await expect(service.postDocument(principal, doc('i1', line({ ledgerId: 'receivable' })))).rejects.toMatchObject({ code: 'INVALID_LINE_LEDGER' });
    await expect(service.postDocument(principal, doc('i1', { date: '2026-02-10' }))).rejects.toMatchObject({ code: 'DATE_OUTSIDE_PERIOD' });
    await expect(service.postDocument(principal, doc('i1', { dueDate: '2026-01-09' }))).rejects.toMatchObject({ code: 'INVALID_DUE_DATE' });
    await expect(service.postDocument(principal, doc('i1', { partyId: 'supply' }))).rejects.toMatchObject({ code: 'PARTY_ROLE_MISMATCH' });
    await expect(service.postDocument(principal, doc('i1', { partyId: 'missing' }))).rejects.toMatchObject({ code: 'PARTY_NOT_FOUND' });
    expect(tradeOf(await book(service)).documents).toEqual([]);
  });
  it('voids by reversal while the posted document and journal stay unchanged; direct edits are refused', async () => {
    const { service } = await setup();
    const posted = await service.postDocument(principal, doc('i1'));
    const before = await book(service);
    await expect(service.reverse(principal, { kind: 'reverse', commandId: 'rev', originalId: posted.journalId, expectedChartVersion: 1, journal: { ...scope, id: 'r1', date: '2026-01-11', periodId: 'jan', expectedPeriodVersion: 1, narration: 'x' } }))
      .rejects.toMatchObject({ code: 'DOCUMENT_JOURNAL' });
    await expect(service.voidDocument(principal, { kind: 'void-document', commandId: 'v0', expectedChartVersion: 1, documentId: 'i1', date: '2026-01-12', periodId: 'jan', expectedPeriodVersion: 1, reason: ' ' }))
      .rejects.toMatchObject({ code: 'REASON_REQUIRED' });
    const voided = await service.voidDocument(principal, { kind: 'void-document', commandId: 'v1', expectedChartVersion: 1, documentId: 'i1', date: '2026-01-12', periodId: 'jan', expectedPeriodVersion: 1, reason: 'Issued in error' });
    const after = await book(service);
    expect(voided).toMatchObject({ status: 'voided', voidJournalId: 'i1:v', voidDate: '2026-01-12', number: posted.number });
    expect(after.entries.find((e) => e.id === 'i1:j')).toEqual(before.entries.find((e) => e.id === 'i1:j'));
    expect(after.entries.find((e) => e.id === 'i1:v')?.reverses).toBe('i1:j');
    expect(after.audit.at(-1)).toMatchObject({ action: 'void-document', reason: 'Issued in error' });
    const edited = structuredClone(after) as BookState; edited.documents![0] = { ...edited.documents![0]!, total: 1n };
    expect(() => validateCommit(after, edited)).toThrow(expect.objectContaining({ code: 'POSTED_DOCUMENT_IMMUTABLE' }));
    await expect(service.voidDocument(principal, { kind: 'void-document', commandId: 'v2', expectedChartVersion: 1, documentId: 'i1', date: '2026-01-12', periodId: 'jan', expectedPeriodVersion: 1, reason: 'again' }))
      .rejects.toMatchObject({ code: 'DOCUMENT_VOIDED' });
  });
  it('reserves party control ledgers for documents in journals, drafts and stored state', async () => {
    const { service } = await setup();
    const bad = journal({ id: 'j9', lines: [{ ledgerId: 'receivable', side: 'debit', amount: 5n }, { ledgerId: 'revenue', side: 'credit', amount: 5n }] });
    await expect(service.post(principal, { kind: 'post', commandId: 'j9', expectedChartVersion: 1, journal: bad })).rejects.toMatchObject({ code: 'CONTROL_LEDGER_RESERVED' });
    await expect(service.saveDraft(principal, { kind: 'save-draft', commandId: 'd9', expectedChartVersion: 1, expectedDraftVersion: null, draft: bad })).rejects.toMatchObject({ code: 'CONTROL_LEDGER_RESERVED' });
    const store = new InMemoryBookStore(); store.register(configuration()); const plain = new AccountingService(store, () => at);
    await plain.post(principal, { kind: 'post', commandId: 'j9', expectedChartVersion: 1, journal: bad });
    await expect(plain.saveParty(principal, party('acme', 'customer'))).rejects.toMatchObject({ code: 'CONTROL_LEDGER_RESERVED' });
  });
});

describe('P6-02 balanced, atomic, idempotent postings with links and numbering', () => {
  it('posts sales and purchase invoices as balanced linked journals', async () => {
    const { service } = await setup();
    const sale = await service.postDocument(principal, doc('i1', { lines: [{ ledgerId: 'revenue', description: 'A', quantity: '2', unitPrice: 500n }, { ledgerId: 'revenue', description: 'B', quantity: '1.5', unitPrice: 101n }] }));
    const purchase = await service.postDocument(principal, doc('p1', { kind: 'purchase-invoice', partyId: 'supply', lines: [{ ledgerId: 'expense', description: 'Rent', quantity: '1', unitPrice: 700n }] }));
    expect(sale).toMatchObject({ total: 1152n, dueDate: '2026-02-09', journalId: 'i1:j', acceptedNumber: null, status: 'posted' });
    expect(purchase).toMatchObject({ total: 700n, dueDate: '2026-01-25', number: 'PI-000001' });
    const state = await book(service);
    expect(state.entries.find((e) => e.id === 'i1:j')?.lines.map((l) => [l.ledgerId, l.side, l.amount])).toEqual([['receivable', 'debit', 1152n], ['revenue', 'credit', 1000n], ['revenue', 'credit', 152n]]);
    expect(state.entries.find((e) => e.id === 'p1:j')?.lines.map((l) => [l.ledgerId, l.side, l.amount])).toEqual([['payable', 'credit', 700n], ['expense', 'debit', 700n]]);
    const tb = trialBalance(state.config, state.entries, '2026-12-31'); expect(tb.debit).toBe(tb.credit);
  });
  it('is idempotent for retries and refuses a reused command ID with different content', async () => {
    const { service } = await setup();
    const first = await service.postDocument(principal, doc('i1'));
    expect(await service.postDocument(principal, doc('i1'))).toEqual(first);
    await expect(service.postDocument(principal, doc('i1', { reference: 'changed' }))).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    await expect(service.postDocument(principal, { ...doc('i1'), commandId: 'other' })).rejects.toMatchObject({ code: 'DUPLICATE_DOCUMENT' });
    const state = await book(service);
    expect(state.entries).toHaveLength(1); expect(tradeOf(state).documents).toHaveLength(1);
  });
  it('numbers each series sequentially without reuse, under concurrency and after voids', async () => {
    const { service } = await setup();
    const results = await Promise.all(['a', 'b', 'c', 'd'].map((id) => service.postDocument(principal, doc(id))));
    expect(results.map((r) => r.number).sort()).toEqual(['SI-000001', 'SI-000002', 'SI-000003', 'SI-000004']);
    await service.voidDocument(principal, { kind: 'void-document', commandId: 'v', expectedChartVersion: 1, documentId: 'd', date: '2026-01-12', periodId: 'jan', expectedPeriodVersion: 1, reason: 'error' });
    expect((await service.postDocument(principal, doc('e'))).number).toBe('SI-000005');
    expect((await service.postDocument(principal, receipt('r', 10n))).number).toBe('RC-000001');
    expect((await service.postDocument(principal, doc('cn', { kind: 'credit-note', lines: [{ ledgerId: 'revenue', description: 'Return', quantity: '1', unitPrice: 5n }] }))).number).toBe('CN-000001');
  });
  it('publishes nothing when a commit fails or a locked period is used', async () => {
    const { service, store } = await setup();
    store.failNextCommit();
    await expect(service.postDocument(principal, receipt('r1', 10n))).rejects.toMatchObject({ code: 'SYNTHETIC_COMMIT_FAILURE' });
    await service.setPeriodStatus(principal, { kind: 'period-status', commandId: 'lock', periodId: 'jan', status: 'locked', expectedVersion: 1, reason: 'close' });
    await expect(service.postDocument(principal, doc('i1', { expectedPeriodVersion: 2 }))).rejects.toMatchObject({ code: 'PERIOD_LOCKED' });
    const state = await book(service);
    expect([state.entries.length, tradeOf(state).documents.length, state.receipts.filter((r) => r.commandId.startsWith('doc-')).length]).toEqual([0, 0, 0]);
  });
});

describe('P6-03 receipts, payments, notes and allocations', () => {
  it('settles bills partially, keeps on-account remainders and rejects over-allocation atomically', async () => {
    const { service } = await setup();
    await service.postDocument(principal, doc('i1'));
    await service.postDocument(principal, doc('i2', { lines: [{ ledgerId: 'revenue', description: 'x', quantity: '1', unitPrice: 400n }] }));
    await expect(service.postDocument(principal, receipt('r1', 1500n, [{ id: 'a1', targetId: 'i1', amount: 1001n }]))).rejects.toMatchObject({ code: 'OVER_ALLOCATION' });
    await expect(service.postDocument(principal, receipt('r1', 500n, [{ id: 'a1', targetId: 'i1', amount: 300n }, { id: 'a2', targetId: 'i2', amount: 300n }]))).rejects.toMatchObject({ code: 'OVER_ALLOCATION' });
    await expect(service.postDocument(principal, receipt('r1', 500n, [{ id: 'a1', targetId: 'i1', amount: 100n }, { id: 'a1', targetId: 'i2', amount: 100n }]))).rejects.toMatchObject({ code: 'DUPLICATE_ALLOCATION' });
    expect(tradeOf(await book(service)).documents).toHaveLength(2);
    await service.postDocument(principal, receipt('r1', 1500n, [{ id: 'a1', targetId: 'i1', amount: 1000n }, { id: 'a2', targetId: 'i2', amount: 300n }]));
    const state = await book(service);
    const report = aging(state.config, tradeOf(state), state.entries, 'customer', '2026-01-31');
    expect(report.bills.map((b) => [b.documentId, b.outstanding])).toEqual([['i2', 100n]]);
    expect(report.credits.map((c) => [c.documentId, c.unallocated])).toEqual([['r1', 200n]]);
    expect(report.net).toBe(-100n);
    await expect(service.allocate(principal, { kind: 'allocate', commandId: 'al', expectedChartVersion: 1, sourceId: 'r1', date: '2026-01-21', allocations: [{ id: 'a3', targetId: 'i2', amount: 101n }] })).rejects.toMatchObject({ code: 'OVER_ALLOCATION' });
    await expect(service.allocate(principal, { kind: 'allocate', commandId: 'al', expectedChartVersion: 1, sourceId: 'i1', date: '2026-01-21', allocations: [{ id: 'a3', targetId: 'i2', amount: 1n }] })).rejects.toMatchObject({ code: 'INVALID_ALLOCATION' });
  });
  it('applies an advance to a later invoice and refuses cross-party or early-dated allocation', async () => {
    const { service } = await setup();
    await service.postDocument(principal, receipt('adv', 600n, [], { date: '2026-01-05' }));
    await service.postDocument(principal, doc('i1'));
    await service.postDocument(principal, doc('g1', { partyId: 'globex' }));
    const allocate = (id: string, targetId: string, date: string, amount = 600n) => service.allocate(principal, { kind: 'allocate', commandId: id, expectedChartVersion: 1, sourceId: 'adv', date, allocations: [{ id, targetId, amount }] });
    await expect(allocate('x1', 'g1', '2026-01-15')).rejects.toMatchObject({ code: 'INVALID_ALLOCATION' });
    await expect(allocate('x2', 'i1', '2026-01-09')).rejects.toMatchObject({ code: 'INVALID_ALLOCATION_DATE' });
    expect(await allocate('x3', 'i1', '2026-01-15')).toEqual([expect.objectContaining({ sourceId: 'adv', targetId: 'i1', amount: 600n })]);
    expect(await allocate('x3', 'i1', '2026-01-15')).toEqual([expect.objectContaining({ id: 'x3' })]);
    const state = await book(service);
    expect(tradeOf(state).allocations).toHaveLength(1);
    expect(partyBalances(state.config, tradeOf(state), state.entries, '2026-01-31').parties.find((p) => p.partyId === 'acme')?.balance).toBe(400n);
  });
  it('credit and debit notes reduce party balances; voiding a settlement releases its allocations; allocated bills cannot be voided', async () => {
    const { service } = await setup();
    await service.postDocument(principal, doc('i1'));
    await service.postDocument(principal, doc('cn', { kind: 'credit-note', date: '2026-01-15', lines: [{ ledgerId: 'revenue', description: 'Return', quantity: '1', unitPrice: 250n }], allocations: [{ id: 'c1', targetId: 'i1', amount: 250n }] }));
    await service.postDocument(principal, doc('p1', { kind: 'purchase-invoice', partyId: 'supply', lines: [{ ledgerId: 'expense', description: 'Stock', quantity: '1', unitPrice: 900n }] }));
    await service.postDocument(principal, doc('dn', { kind: 'debit-note', partyId: 'supply', date: '2026-01-15', lines: [{ ledgerId: 'expense', description: 'Returned', quantity: '1', unitPrice: 100n }], allocations: [{ id: 'd1', targetId: 'p1', amount: 100n }] }));
    await service.postDocument(principal, doc('py', { kind: 'payment', partyId: 'supply', lines: [], liquidLedgerId: 'cash', amount: 800n, date: '2026-01-20', allocations: [{ id: 'p-a', targetId: 'p1', amount: 800n }] }));
    const voidCmd = (id: string, documentId: string) => ({ kind: 'void-document' as const, commandId: id, expectedChartVersion: 1, documentId, date: '2026-01-25', periodId: 'jan', expectedPeriodVersion: 1, reason: 'correction' });
    await expect(service.voidDocument(principal, voidCmd('v1', 'i1'))).rejects.toMatchObject({ code: 'DOCUMENT_ALLOCATED' });
    await service.voidDocument(principal, voidCmd('v2', 'cn'));
    const state = await book(service); const trade = tradeOf(state);
    expect(aging(state.config, trade, state.entries, 'customer', '2026-01-31').bills.map((b) => b.outstanding)).toEqual([1000n]);
    expect(aging(state.config, trade, state.entries, 'customer', '2026-01-20').bills.map((b) => b.outstanding)).toEqual([750n]);
    const balances = partyBalances(state.config, trade, state.entries, '2026-01-31');
    expect(balances.parties.map((p) => [p.partyId, p.balance])).toEqual([['acme', 1000n], ['globex', 0n], ['supply', 0n]]);
    expect(aging(state.config, trade, state.entries, 'supplier', '2026-01-31')).toMatchObject({ bills: [], credits: [], net: 0n });
  });
});

describe('P6-04 receivables/payables, aging and control reconciliation', () => {
  it('buckets by days past due and ties each control ledger to its parties at any date', async () => {
    const { service } = await setup();
    await service.extendCalendar(principal, { kind: 'extend-calendar', commandId: 'fy27', expectedChartVersion: 1, reason: 'next year',
      year: { ...scope, id: 'fy27', start: '2027-01-01', end: '2027-12-31' }, period: { ...scope, id: 'y27', yearId: 'fy27', start: '2027-01-01', end: '2027-12-31', status: 'open', version: 1 } });
    await service.postDocument(principal, doc('due-now', { dueDate: '2026-01-31' }));
    await service.postDocument(principal, doc('g1', { partyId: 'globex', date: '2026-01-01' }));
    await service.postDocument(principal, doc('p1', { kind: 'purchase-invoice', partyId: 'supply', lines: [{ ledgerId: 'expense', description: 'x', quantity: '3', unitPrice: 100n }] }));
    const state = await book(service); const trade = tradeOf(state);
    const at = (date: string) => aging(state.config, trade, state.entries, 'customer', date);
    expect(at('2026-01-31').bills.map((b) => [b.documentId, b.bucket])).toEqual([['due-now', 'current'], ['g1', '1-30']]);
    expect(at('2026-04-15').buckets).toEqual({ current: 0n, '1-30': 0n, '31-60': 0n, '61-90': 1000n, 'over-90': 1000n });
    expect(at('2026-01-05').bills.map((b) => b.documentId)).toEqual(['g1']);
    const balances = partyBalances(state.config, trade, state.entries, '2026-12-31');
    expect(balances.controls.map((c) => [c.ledgerId, c.balance])).toEqual([['receivable', 2000n], ['payable', -300n]]);
    expect(aging(state.config, trade, state.entries, 'supplier', '2026-12-31').net).toBe(300n);
    const tampered = structuredClone(state) as BookState; tampered.documents![0] = { ...tampered.documents![0]!, total: 999n };
    expect(() => partyBalances(tampered.config, tradeOf(tampered), tampered.entries, '2026-12-31')).toThrow(expect.objectContaining({ code: 'CONTROL_MISMATCH' }));
  });
  it('keeps books saved before Phase 6 valid and leaves them unchanged by non-trade commands', async () => {
    const store = new InMemoryBookStore(); store.register(configuration()); const service = new AccountingService(store, () => at);
    await service.post(principal, { kind: 'post', commandId: 'j1', expectedChartVersion: 1, journal: journal() });
    const legacy = await book(service);
    expect('documents' in legacy).toBe(false);
    expect(tradeOf(legacy)).toEqual({ parties: [], documents: [], allocations: [] });
  });
});
