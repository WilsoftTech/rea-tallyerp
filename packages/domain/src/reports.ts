import { businessDate, dateRange } from './calendar.js';
import type { DateRange } from './calendar.js';
import { ensure, freeze } from './errors.js';
import { validateJournalInput } from './journal.js';
import type { JournalEntry } from './journal.js';
import type { BookConfig } from './model.js';
import { sameScope } from './model.js';

function ordered(book: BookConfig, entries: readonly JournalEntry[]): JournalEntry[] {
  const ids = new Set<string>();
  for (const entry of entries) {
    sameScope(book.company, entry);
    ensure(!ids.has(entry.id), 'DUPLICATE_JOURNAL', 'Report input contains duplicate journal IDs.'); ids.add(entry.id);
    const period = book.periods.find((row) => row.id === entry.periodId);
    ensure(period?.yearId === entry.yearId, 'ENTRY_PERIOD_MISMATCH', 'Journal financial year must match its referenced period.');
    ensure(entry.currency.code === book.company.currency.code && entry.currency.scale === book.company.currency.scale, 'CURRENCY_MISMATCH', 'Report currency must match the book.');
    const lines = validateJournalInput(book, { ...entry, expectedPeriodVersion: entry.periodVersion }, false);
    ensure(lines.every((line, index) => line.nature === entry.lines[index]?.nature), 'NATURE_MISMATCH', 'Historical classification differs from the chart.');
  }
  return [...entries].sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export function ledgerStatement(book: BookConfig, entries: readonly JournalEntry[], ledgerId: string, range: DateRange) {
  dateRange(range.start, range.end);
  const ledger = book.ledgers.find((row) => row.id === ledgerId);
  ensure(ledger, 'LEDGER_NOT_FOUND', 'Report ledger must belong to the company.');
  let opening = 0n; let balance = 0n;
  const rows: { entryId: string; date: string; debit: bigint; credit: bigint; balance: bigint }[] = [];
  for (const entry of ordered(book, entries)) {
    if (entry.date > range.end) continue;
    for (const line of entry.lines.filter((line) => line.ledgerId === ledgerId)) {
      const delta = line.side === 'debit' ? line.amount : -line.amount;
      balance += delta;
      if (entry.date < range.start) opening += delta;
      else rows.push({ entryId: entry.id, date: entry.date, debit: line.side === 'debit' ? line.amount : 0n, credit: line.side === 'credit' ? line.amount : 0n, balance });
    }
  }
  return freeze({ ledgerId: ledger.id, ledgerName: ledger.name, start: range.start, end: range.end, opening, rows, closing: balance });
}

/** Cumulative closing trial balance, not gross voucher turnover. Wide exact sums. */
export function trialBalance(book: BookConfig, entries: readonly JournalEntry[], through: string) {
  businessDate(through, 'through');
  const balances = new Map(book.ledgers.map((ledger) => [ledger.id, 0n]));
  for (const entry of ordered(book, entries)) {
    if (entry.date > through) continue;
    for (const line of entry.lines) balances.set(line.ledgerId, (balances.get(line.ledgerId) ?? 0n) + (line.side === 'debit' ? line.amount : -line.amount));
  }
  const rows = book.ledgers.map((ledger) => {
    const balance = balances.get(ledger.id) ?? 0n;
    return { ledgerId: ledger.id, ledgerName: ledger.name, debit: balance > 0n ? balance : 0n, credit: balance < 0n ? -balance : 0n };
  });
  const debit = rows.reduce((sum, row) => sum + row.debit, 0n);
  const credit = rows.reduce((sum, row) => sum + row.credit, 0n);
  ensure(debit === credit, 'UNBALANCED_BOOK', 'Trial balance does not reconcile.');
  return freeze({ through, rows, debit, credit });
}
