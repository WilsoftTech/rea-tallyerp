import { businessDate, contains } from './calendar.js';
import { ensure, freeze, identifier } from './errors.js';
import { minor, currency } from './money.js';
import { sameScope, version } from './model.js';
import type { BookConfig, Nature, Scope } from './model.js';
import type { Currency } from './money.js';

export type Intent = 'general' | 'payment' | 'receipt' | 'transfer' | 'opening';
export interface LineInput { readonly ledgerId: string; readonly side: 'debit' | 'credit'; readonly amount: bigint }
export interface JournalInput extends Scope {
  readonly id: string; readonly date: string; readonly periodId: string; readonly expectedPeriodVersion: number;
  readonly intent: Intent; readonly narration: string; readonly lines: readonly LineInput[];
}
export interface JournalLine extends LineInput { readonly ledgerName: string; readonly nature: Nature }
export interface JournalEntry extends Scope {
  readonly id: string; readonly date: string; readonly periodId: string; readonly yearId: string;
  readonly periodVersion: number; readonly intent: Intent; readonly narration: string;
  readonly currency: Currency; readonly lines: readonly JournalLine[];
  readonly actorId: string; readonly createdAt: string; readonly reverses: string | null;
}
export interface DraftVoucher extends JournalInput { readonly version: number; readonly status: 'draft' | 'posted' }

export function timestamp(value: string): string {
  ensure(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value), 'INVALID_TIMESTAMP', 'Use a UTC timestamp with millisecond precision.');
  businessDate(value.slice(0, 10));
  ensure(Number(value.slice(11, 13)) < 24 && Number(value.slice(14, 16)) < 60 && Number(value.slice(17, 19)) < 60, 'INVALID_TIMESTAMP', 'Use a valid UTC time.');
  return value;
}

export function validateLines(book: BookConfig, lines: readonly LineInput[]): readonly JournalLine[] {
  ensure(Array.isArray(lines) && lines.length <= 1000, 'INVALID_LINES', 'Use at most 1,000 journal lines.', 'lines');
  return freeze(lines.map((line) => {
    identifier(line.ledgerId, 'ledgerId');
    const ledger = book.ledgers.find((row) => row.id === line.ledgerId);
    ensure(ledger, 'LEDGER_NOT_FOUND', 'Ledger must belong to this company.', 'ledgerId');
    ensure(line.side === 'debit' || line.side === 'credit', 'INVALID_SIDE', 'Line requires a debit or credit side.', 'side');
    ensure(minor(line.amount) > 0n, 'INVALID_AMOUNT', 'Journal line amounts must be strictly positive.', 'amount');
    const group = book.groups.find((row) => row.id === ledger.groupId);
    ensure(group, 'GROUP_NOT_FOUND', 'Ledger group is missing.');
    return { ledgerId: ledger.id, side: line.side, amount: line.amount, ledgerName: ledger.name, nature: group.nature };
  }));
}

export function validateJournalInput(book: BookConfig, input: JournalInput, requireOpen = true): readonly JournalLine[] {
  sameScope(book.company, input); identifier(input.id, 'id'); businessDate(input.date); version(input.expectedPeriodVersion);
  ensure(['general', 'payment', 'receipt', 'transfer', 'opening'].includes(input.intent), 'INVALID_INTENT', 'Unsupported voucher intent.', 'intent');
  ensure(typeof input.narration === 'string' && input.narration.length <= 2000, 'INVALID_NARRATION', 'Narration must be text of at most 2,000 characters.', 'narration');
  const period = book.periods.find((row) => row.id === input.periodId);
  ensure(period, 'PERIOD_NOT_FOUND', 'Period must belong to this company.', 'periodId');
  ensure(input.date >= book.company.booksFrom && contains(period, input.date), 'DATE_OUTSIDE_PERIOD', 'Posting date must be within the selected period and on/after books beginning.', 'date');
  if (requireOpen) {
    ensure(period.status === 'open', 'PERIOD_LOCKED', 'Posting requires an open financial period.', 'periodId');
    ensure(period.version === input.expectedPeriodVersion, 'VERSION_CONFLICT', 'Financial period changed; refresh before posting.', 'periodId');
  }
  const lines = validateLines(book, input.lines);
  ensure(lines.length >= 2, 'INVALID_LINES', 'A posted journal needs at least two nonzero lines.', 'lines');
  const debit = lines.reduce((sum, line) => sum + (line.side === 'debit' ? line.amount : 0n), 0n);
  const credit = lines.reduce((sum, line) => sum + (line.side === 'credit' ? line.amount : 0n), 0n);
  ensure(debit === credit, 'UNBALANCED_JOURNAL', 'Total debits must equal total credits exactly.', 'lines');
  const liquid = lines.filter((line) => book.ledgers.find((ledger) => ledger.id === line.ledgerId)?.kind !== 'general');
  if (input.intent === 'payment') ensure(liquid.length && liquid.every((line) => line.side === 'credit'), 'INVALID_PAYMENT', 'Payments require cash/bank credits and no cash/bank debit.', 'lines');
  if (input.intent === 'receipt') ensure(liquid.length && liquid.every((line) => line.side === 'debit'), 'INVALID_RECEIPT', 'Receipts require cash/bank debits and no cash/bank credit.', 'lines');
  if (input.intent === 'transfer') ensure(liquid.length === lines.length, 'INVALID_TRANSFER', 'Transfers use only cash/bank accounts.', 'lines');
  if (input.intent === 'opening') ensure(input.date === book.company.booksFrom, 'INVALID_OPENING_DATE', 'Opening journals use the books-beginning date.', 'date');
  return lines;
}

export function postJournal(book: BookConfig, input: JournalInput, actorId: string, createdAt: string): JournalEntry {
  const lines = validateJournalInput(book, input);
  const period = book.periods.find((row) => row.id === input.periodId);
  ensure(period, 'PERIOD_NOT_FOUND', 'Period is missing.');
  return freeze({ tenantId: input.tenantId, companyId: input.companyId, id: input.id, date: input.date,
    periodId: period.id, yearId: period.yearId, periodVersion: period.version, intent: input.intent,
    narration: input.narration, currency: currency(book.company.currency.code, book.company.currency.scale),
    lines, actorId: identifier(actorId, 'actorId'), createdAt: timestamp(createdAt), reverses: null });
}

export function reverseJournal(book: BookConfig, original: JournalEntry, input: Omit<JournalInput, 'lines' | 'intent'>, actorId: string, createdAt: string): JournalEntry {
  sameScope(book.company, original);
  ensure(original.reverses === null, 'INVALID_REVERSAL', 'Reverse the original entry only once; use a linked adjustment for further corrections.');
  ensure(input.id !== original.id && input.date >= original.date, 'INVALID_REVERSAL', 'Reversal requires a new ID and a date on/after its original.');
  ensure(input.narration.trim().length > 0, 'REASON_REQUIRED', 'Reversal requires an audit reason.', 'narration');
  const reversed = postJournal(book, { ...input, intent: 'general', lines: original.lines.map((line) => ({ ledgerId: line.ledgerId, side: line.side === 'debit' ? 'credit' : 'debit', amount: line.amount })) }, actorId, createdAt);
  return freeze({ ...reversed, reverses: original.id });
}
