import { describe, expect, it } from 'vitest';
import { AccountingError, MAX_MINOR, defineBook, ledgerStatement, postJournal, reverseJournal, trialBalance } from '../src/index.js';
import type { JournalInput } from '../src/index.js';
import { at, cash, configuration, equity, journal, scope } from './fixtures.js';

describe('company/chart/financial-period contracts', () => {
  it('copies and freezes configuration without freezing caller data', () => {
    const input = structuredClone(configuration()); const book = defineBook(input);
    expect(Object.isFrozen(book.ledgers)).toBe(true);
    expect(Object.isFrozen(input.ledgers)).toBe(false);
  });
  it.each(['tenantId', 'companyId'] as const)('rejects cross-%s master references', (key) => {
    const book = configuration();
    expect(() => defineBook({ ...book, ledgers: book.ledgers.map((row) => ({ ...row, [key]: 'foreign' })) })).toThrow(expect.objectContaining({ code: 'SCOPE_MISMATCH' }));
  });
  it('rejects cycles, missing parents and incompatible natures', () => {
    const book = configuration();
    expect(() => defineBook({ ...book, groups: book.groups.map((row) => ({ ...row, parentId: row.id })) })).toThrow(expect.objectContaining({ code: 'GROUP_CYCLE' }));
    expect(() => defineBook({ ...book, groups: [...book.groups, { ...scope, id: 'child', name: 'Child', nature: 'expense', parentId: 'asset' }] })).toThrow(expect.objectContaining({ code: 'NATURE_MISMATCH' }));
    expect(() => defineBook({ ...book, groups: book.groups.map((row) => ({ ...row, parentId: 'missing' })) })).toThrow(AccountingError);
  });
  it('normalizes company-scoped duplicate names and rejects duplicate IDs', () => {
    const book = configuration();
    expect(() => defineBook({ ...book, ledgers: [...book.ledgers, { ...book.ledgers[0]!, id: 'new', name: ' CASH ' }] })).toThrow(expect.objectContaining({ code: 'DUPLICATE_NAME' }));
    expect(() => defineBook({ ...book, ledgers: [...book.ledgers, book.ledgers[0]!] })).toThrow(AccountingError);
  });
  it('rejects overlapping years/periods, inverted dates and periods outside their year', () => {
    const book = configuration();
    expect(() => defineBook({ ...book, years: [...book.years, { ...book.years[0]!, id: 'overlap' }] })).toThrow(AccountingError);
    expect(() => defineBook({ ...book, periods: [...book.periods, { ...book.periods[0]!, id: 'overlap' }] })).toThrow(AccountingError);
    expect(() => defineBook({ ...book, periods: [{ ...book.periods[0]!, start: '2026-02-28', end: '2026-02-01' }] })).toThrow(expect.objectContaining({ code: 'INVALID_PERIOD_RANGE', field: 'endDate' }));
    expect(() => defineBook({ ...book, periods: [{ ...book.periods[0]!, end: '2027-01-01' }] })).toThrow(AccountingError);
  });
});

describe('immutable posting and accounting invariants', () => {
  it.each([
    { lines: [cash] }, { lines: [cash, { ...equity, amount: 999n }] },
    { lines: [cash, { ...equity, amount: 0n }] }, { lines: [cash, { ...equity, amount: -1000n }] },
    { lines: [cash, { ...equity, ledgerId: 'foreign' }] }, { companyId: 'other' }, { tenantId: 'other' },
    { date: '2025-12-31' }, { date: '2027-01-01' }, { expectedPeriodVersion: 2 },
  ] satisfies Partial<JournalInput>[])('rejects invalid financial command %#', (override) => {
    expect(() => postJournal(configuration(), journal(override), 'actor', at)).toThrow(AccountingError);
  });
  it('rejects closed periods and dates before books beginning', () => {
    const book = configuration();
    expect(() => postJournal(configuration({ periods: book.periods.map((p) => ({ ...p, status: 'locked' })) }), journal(), 'actor', at)).toThrow(expect.objectContaining({ code: 'PERIOD_LOCKED' }));
    expect(() => postJournal(configuration({ company: { ...book.company, booksFrom: '2026-01-20' } }), journal(), 'actor', at)).toThrow(AccountingError);
  });
  it('requires balanced opening journals exactly on books beginning', () => {
    expect(postJournal(configuration(), journal({ intent: 'opening', date: '2026-01-01' }), 'actor', at).intent).toBe('opening');
    expect(() => postJournal(configuration(), journal({ intent: 'opening' }), 'actor', at)).toThrow(AccountingError);
  });
  it('enforces payment, receipt and transfer intent without copying vendor journal restrictions', () => {
    const book = configuration();
    const payment = [{ ledgerId: 'expense', side: 'debit' as const, amount: 200n }, { ledgerId: 'cash', side: 'credit' as const, amount: 200n }];
    expect(postJournal(book, journal({ intent: 'payment', lines: payment }), 'actor', at).intent).toBe('payment');
    expect(postJournal(book, journal({ intent: 'receipt' }), 'actor', at).intent).toBe('receipt');
    expect(postJournal(book, journal({ intent: 'transfer', lines: [cash, { ...equity, ledgerId: 'bank' }] }), 'actor', at).intent).toBe('transfer');
    expect(() => postJournal(book, journal({ intent: 'payment' }), 'actor', at)).toThrow(AccountingError);
    expect(() => postJournal(book, journal({ intent: 'receipt', lines: payment }), 'actor', at)).toThrow(AccountingError);
    expect(() => postJournal(book, journal({ intent: 'transfer' }), 'actor', at)).toThrow(AccountingError);
  });
  it('detaches snapshots and makes reversal an additional opposite-side entry', () => {
    const input = structuredClone(journal()); const original = postJournal(configuration(), input, 'actor', at);
    expect(Reflect.set(original, 'date', '2026-01-01')).toBe(false);
    expect(Reflect.set(original.lines[0]!, 'amount', 0n)).toBe(false);
    expect(Object.isFrozen(input)).toBe(false);
    const reversed = reverseJournal(configuration(), original, { ...journal(), id: 'reverse', date: '2026-02-02', periodId: 'feb', narration: 'Correct error' }, 'actor', at);
    expect(reversed.reverses).toBe(original.id); expect(reversed.lines[0]?.side).toBe('credit');
    expect(original.lines[0]?.side).toBe('debit');
    expect(() => reverseJournal(configuration(), original, { ...journal(), id: 'r2', narration: '' }, 'actor', at)).toThrow(AccountingError);
  });
});

describe('hand-worked reconciliation and exact reports', () => {
  it('reconciles J1–J4 to 1300 each and J5 full expense reversal without changing J2', () => {
    const book = configuration();
    const entries = [
      postJournal(book, journal({ id: 'j1' }), 'actor', at),
      postJournal(book, journal({ id: 'j2', lines: [{ ledgerId: 'expense', side: 'debit', amount: 200n }, { ledgerId: 'cash', side: 'credit', amount: 200n }] }), 'actor', at),
      postJournal(book, journal({ id: 'j3', lines: [{ ledgerId: 'receivable', side: 'debit', amount: 300n }, { ledgerId: 'revenue', side: 'credit', amount: 300n }] }), 'actor', at),
      postJournal(book, journal({ id: 'j4', lines: [{ ...cash, amount: 100n }, { ledgerId: 'receivable', side: 'credit', amount: 100n }] }), 'actor', at),
    ];
    const first = trialBalance(book, entries, '2026-01-31');
    expect(first.debit).toBe(1300n); expect(first.credit).toBe(1300n);
    expect(first.rows.find((r) => r.ledgerId === 'cash')?.debit).toBe(900n);
    expect(first.rows.find((r) => r.ledgerId === 'receivable')?.debit).toBe(200n);
    expect(first.rows.find((r) => r.ledgerId === 'expense')?.debit).toBe(200n);
    const j5 = reverseJournal(book, entries[1]!, { ...journal(), id: 'j5', date: '2026-02-01', periodId: 'feb', narration: 'Reverse expense' }, 'actor', at);
    const report = trialBalance(book, [...entries, j5], '2026-02-28');
    expect(report.debit).toBe(1300n); expect(report.credit).toBe(1300n);
    expect(report.rows.find((r) => r.ledgerId === 'cash')?.debit).toBe(1100n);
    expect(report.rows.find((r) => r.ledgerId === 'expense')?.debit).toBe(0n);
    const statement = ledgerStatement(book, [...entries, j5], 'cash', { start: '2026-02-01', end: '2026-02-28' });
    expect(statement.opening).toBe(900n); expect(statement.rows).toHaveLength(1); expect(statement.closing).toBe(1100n);
    expect(entries[1]?.lines[0]?.amount).toBe(200n);
  });
  it('uses wide aggregate sums and rejects duplicate/foreign/corrupted input', () => {
    const book = configuration(); const entry = postJournal(book, journal({ lines: [{ ...cash, amount: MAX_MINOR }, { ...equity, amount: MAX_MINOR }] }), 'actor', at);
    const entry2 = postJournal(book, journal({ id: 'j2', lines: [{ ...cash, amount: MAX_MINOR }, { ...equity, amount: MAX_MINOR }] }), 'actor', at);
    expect(trialBalance(book, [entry, entry2], '2026-01-31').debit).toBe(MAX_MINOR * 2n);
    expect(() => trialBalance(book, [entry, entry], '2026-01-31')).toThrow(AccountingError);
    expect(() => trialBalance(book, [{ ...entry, tenantId: 'foreign' }], '2026-01-31')).toThrow(AccountingError);
    expect(() => trialBalance(book, [{ ...entry, yearId: 'wrong-year' }], '2026-01-31')).toThrow(expect.objectContaining({ code: 'ENTRY_PERIOD_MISMATCH' }));
    expect(() => trialBalance(book, [{ ...entry, lines: [{ ...entry.lines[0]!, amount: 1n }, entry.lines[1]!] }], '2026-01-31')).toThrow(AccountingError);
  });
});
