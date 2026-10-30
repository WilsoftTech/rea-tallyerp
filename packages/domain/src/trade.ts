import { addDays, businessDate } from './calendar.js';
import { ensure, freeze, identifier } from './errors.js';
import { postJournal, reverseJournal } from './journal.js';
import type { JournalEntry, LineInput } from './journal.js';
import { label, sameScope, version } from './model.js';
import type { BookConfig, Scope } from './model.js';
import { minor, roundRatio } from './money.js';

export type PartyRole = 'customer' | 'supplier';
export interface Party extends Scope {
  readonly id: string; readonly name: string; readonly role: PartyRole;
  /** Receivable (asset) or payable (liability) general ledger; only documents may post to it. */
  readonly controlLedgerId: string; readonly creditDays: number; readonly version: number;
}
export type BillKind = 'sales-invoice' | 'purchase-invoice';
export type SettlementKind = 'receipt' | 'payment' | 'credit-note' | 'debit-note';
export type DocumentKind = BillKind | SettlementKind;
/** Quantity is a decimal string (at most 4 fractional digits); unit price is exact minor units. */
export interface DocumentLineInput { readonly ledgerId: string; readonly description: string; readonly quantity: string; readonly unitPrice: bigint }
export interface DocumentLine extends DocumentLineInput { readonly amount: bigint }
export interface AllocationInput { readonly id: string; readonly targetId: string; readonly amount: bigint }
export interface DocumentInput extends Scope {
  readonly id: string; readonly kind: DocumentKind; readonly partyId: string;
  readonly date: string; readonly periodId: string; readonly expectedPeriodVersion: number;
  /** Bills only; null derives date + party credit days. */
  readonly dueDate: string | null;
  readonly reference: string; readonly narration: string;
  /** Invoices and notes. */
  readonly lines: readonly DocumentLineInput[];
  /** Receipts/payments: the cash or bank ledger and exact amount. */
  readonly liquidLedgerId: string | null; readonly amount: bigint | null;
  /** Settlement documents only: bills settled immediately; any remainder stays on account. */
  readonly allocations: readonly AllocationInput[];
}
export interface TradeDocument extends Scope {
  readonly id: string; readonly kind: DocumentKind; readonly partyId: string; readonly date: string; readonly dueDate: string | null;
  /** Local provisional series number; acceptedNumber is assigned only by the authoritative service. */
  readonly number: string; readonly acceptedNumber: string | null;
  readonly reference: string; readonly narration: string; readonly lines: readonly DocumentLine[];
  readonly liquidLedgerId: string | null; readonly total: bigint; readonly journalId: string;
  readonly status: 'posted' | 'voided'; readonly voidJournalId: string | null; readonly voidDate: string | null;
}
export interface Allocation extends Scope {
  readonly id: string; readonly sourceId: string; readonly targetId: string; readonly amount: bigint; readonly date: string;
}
export interface TradeState {
  readonly parties: readonly Party[]; readonly documents: readonly TradeDocument[]; readonly allocations: readonly Allocation[];
}

const BILLS: readonly string[] = ['sales-invoice', 'purchase-invoice'];
const SERIES: Record<DocumentKind, string> = { 'sales-invoice': 'SI', 'purchase-invoice': 'PI', 'credit-note': 'CN', 'debit-note': 'DN', receipt: 'RC', payment: 'PY' };
const ROLE: Record<DocumentKind, PartyRole> = { 'sales-invoice': 'customer', receipt: 'customer', 'credit-note': 'customer', 'purchase-invoice': 'supplier', payment: 'supplier', 'debit-note': 'supplier' };
/** Side of the party control ledger: debit raises a receivable or reduces a payable. */
const CONTROL: Record<DocumentKind, 'debit' | 'credit'> = { 'sales-invoice': 'debit', 'debit-note': 'debit', payment: 'debit', 'purchase-invoice': 'credit', 'credit-note': 'credit', receipt: 'credit' };

export const isBill = (kind: DocumentKind): kind is BillKind => BILLS.includes(kind);
export const journalIdOf = (documentId: string) => documentId + ':j';
export const voidJournalIdOf = (documentId: string) => documentId + ':v';

function text(value: string, field: string, max: number): string {
  ensure(typeof value === 'string' && value.length <= max && [...value].every((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127), 'INVALID_TEXT', `Use text of at most ${max} characters.`, field);
  return value;
}

/** Exact line amount: quantity × unit price rounded half away from zero to the currency's minor unit. */
export function lineAmount(quantity: string, unitPrice: bigint): bigint {
  ensure(typeof quantity === 'string' && /^(0|[1-9]\d{0,11})(\.\d{1,4})?$/.test(quantity), 'INVALID_QUANTITY', 'Enter a positive quantity with at most 4 decimal places.', 'quantity');
  const [whole = '', fraction = ''] = quantity.split('.');
  const scaled = BigInt(whole + fraction);
  ensure(scaled > 0n, 'INVALID_QUANTITY', 'Quantity must be greater than zero.', 'quantity');
  ensure(minor(unitPrice) > 0n, 'INVALID_PRICE', 'Unit price must be greater than zero.', 'unitPrice');
  const amount = roundRatio(scaled * unitPrice, 10n ** BigInt(fraction.length), 'half-away');
  ensure(amount > 0n, 'INVALID_AMOUNT', 'Line amount rounds to zero; adjust quantity or price.', 'amount');
  return amount;
}

export function defineParty(book: BookConfig, input: Party): Party {
  sameScope(book.company, input); identifier(input.id, 'partyId'); version(input.version);
  ensure(input.role === 'customer' || input.role === 'supplier', 'INVALID_PARTY_ROLE', 'Party must be a customer or a supplier.', 'role');
  ensure(Number.isSafeInteger(input.creditDays) && input.creditDays >= 0 && input.creditDays <= 3650, 'INVALID_CREDIT_DAYS', 'Credit days must be a whole number from 0 to 3650.', 'creditDays');
  const ledger = book.ledgers.find((row) => row.id === input.controlLedgerId);
  ensure(ledger, 'LEDGER_NOT_FOUND', 'Control ledger must belong to this company.', 'controlLedgerId');
  const nature = book.groups.find((row) => row.id === ledger.groupId)?.nature;
  ensure(ledger.kind === 'general' && nature === (input.role === 'customer' ? 'asset' : 'liability'), 'INVALID_CONTROL_LEDGER',
    input.role === 'customer' ? 'Customer control ledger must be a general asset ledger.' : 'Supplier control ledger must be a general liability ledger.', 'controlLedgerId');
  return freeze({ tenantId: input.tenantId, companyId: input.companyId, id: input.id, name: label(input.name), role: input.role,
    controlLedgerId: ledger.id, creditDays: input.creditDays, version: input.version });
}

/** Validate masters against the chart and each other; party names are unique per company. */
export function checkParties(book: BookConfig, parties: readonly Party[]): void {
  const ids = new Set<string>(); const names = new Set<string>();
  const control = new Set(parties.map((party) => party.controlLedgerId));
  for (const party of parties) {
    defineParty(book, party);
    ensure(!ids.has(party.id), 'DUPLICATE_ID', 'Party identifiers must be unique.'); ids.add(party.id);
    const key = party.name.trim().normalize('NFKC').toLowerCase();
    ensure(!names.has(key), 'DUPLICATE_NAME', 'Party names must be unique within this company.', 'name'); names.add(key);
  }
  for (const ledgerId of control) {
    const roles = new Set(parties.filter((party) => party.controlLedgerId === ledgerId).map((party) => party.role));
    ensure(roles.size === 1, 'INVALID_CONTROL_LEDGER', 'A control ledger serves customers or suppliers, not both.', 'controlLedgerId');
  }
}

export function controlLedgers(state: Pick<TradeState, 'parties'>): ReadonlySet<string> {
  return new Set(state.parties.map((party) => party.controlLedgerId));
}

/** Active means the source document is not voided; voiding a settlement releases its allocations. */
function active(state: TradeState, allocation: Allocation, asOf = '9999-12-31'): boolean {
  if (allocation.date > asOf) return false;
  const source = state.documents.find((row) => row.id === allocation.sourceId);
  return Boolean(source) && !(source!.status === 'voided' && source!.voidDate! <= asOf);
}
function live(document: TradeDocument, asOf: string): boolean {
  return document.date <= asOf && !(document.status === 'voided' && document.voidDate! <= asOf);
}
export function outstanding(state: TradeState, document: TradeDocument, asOf = '9999-12-31'): bigint {
  if (!live(document, asOf)) return 0n;
  const key = isBill(document.kind) ? 'targetId' : 'sourceId';
  return document.total - state.allocations.filter((row) => row[key] === document.id && active(state, row, asOf)).reduce((sum, row) => sum + row.amount, 0n);
}

function allocate(state: TradeState, source: TradeDocument, inputs: readonly AllocationInput[], date: string): Allocation[] {
  ensure(Array.isArray(inputs) && inputs.length <= 1000, 'INVALID_ALLOCATIONS', 'Use at most 1,000 allocations.', 'allocations');
  ensure(!isBill(source.kind), 'INVALID_ALLOCATION', 'Only receipts, payments and notes settle bills.', 'sourceId');
  ensure(source.status === 'posted', 'DOCUMENT_VOIDED', 'A voided document cannot settle bills.', 'sourceId');
  ensure(date >= source.date, 'INVALID_ALLOCATION_DATE', 'Allocation date must be on or after the settling document.', 'date');
  let remaining = outstanding(state, source); const used = new Map<string, bigint>(); const result: Allocation[] = [];
  for (const input of inputs) {
    identifier(input.id, 'allocationId');
    ensure(!state.allocations.some((row) => row.id === input.id) && !result.some((row) => row.id === input.id), 'DUPLICATE_ALLOCATION', 'Allocation ID already exists.', 'allocationId');
    ensure(minor(input.amount) > 0n, 'INVALID_AMOUNT', 'Allocation amounts must be greater than zero.', 'amount');
    const target = state.documents.find((row) => row.id === input.targetId);
    ensure(target && isBill(target.kind) && target.partyId === source.partyId, 'INVALID_ALLOCATION', 'Allocate only to a bill of the same party.', 'targetId');
    ensure(target.status === 'posted', 'DOCUMENT_VOIDED', 'Cannot settle a voided bill.', 'targetId');
    ensure(date >= target.date, 'INVALID_ALLOCATION_DATE', 'Allocation date must be on or after the bill date.', 'date');
    const prior = used.get(target.id) ?? 0n;
    ensure(prior + input.amount <= outstanding(state, target), 'OVER_ALLOCATION', 'Allocation exceeds the bill outstanding.', 'amount');
    ensure(input.amount <= remaining, 'OVER_ALLOCATION', 'Allocations exceed the unallocated document amount.', 'amount');
    used.set(target.id, prior + input.amount); remaining -= input.amount;
    result.push(freeze({ tenantId: source.tenantId, companyId: source.companyId, id: input.id, sourceId: source.id, targetId: target.id, amount: input.amount, date }));
  }
  return result;
}

export interface PostedDocument { readonly document: TradeDocument; readonly journal: JournalEntry; readonly allocations: readonly Allocation[] }

export function postDocument(book: BookConfig, state: TradeState, input: DocumentInput, actorId: string, createdAt: string): PostedDocument {
  sameScope(book.company, input); identifier(input.id, 'documentId');
  ensure(input.id.length <= 96, 'INVALID_ID', 'Document IDs are at most 96 characters.', 'documentId');
  ensure(Object.hasOwn(SERIES, input.kind), 'INVALID_DOCUMENT_KIND', 'Select a supported document type.', 'kind');
  ensure(!state.documents.some((row) => row.id === input.id), 'DUPLICATE_DOCUMENT', 'Document ID already exists.', 'documentId');
  const party = state.parties.find((row) => row.id === input.partyId);
  ensure(party, 'PARTY_NOT_FOUND', 'Party must belong to this company.', 'partyId');
  ensure(party.role === ROLE[input.kind], 'PARTY_ROLE_MISMATCH', ROLE[input.kind] === 'customer' ? 'This document requires a customer.' : 'This document requires a supplier.', 'partyId');
  businessDate(input.date);
  const reference = text(input.reference, 'reference', 100); const narration = text(input.narration, 'narration', 2000);
  const control = controlLedgers(state);
  let lines: DocumentLine[] = []; let liquidLedgerId: string | null = null; let total: bigint;
  if (input.kind === 'receipt' || input.kind === 'payment') {
    ensure(Array.isArray(input.lines) && input.lines.length === 0, 'INVALID_LINES', 'Receipts and payments carry an amount, not item lines.', 'lines');
    const liquid = book.ledgers.find((row) => row.id === input.liquidLedgerId);
    ensure(liquid && liquid.kind !== 'general', 'INVALID_LEDGER_KIND', 'Select a cash or bank ledger.', 'liquidLedgerId');
    ensure(typeof input.amount === 'bigint' && minor(input.amount) > 0n, 'INVALID_AMOUNT', 'Amount must be greater than zero.', 'amount');
    liquidLedgerId = liquid.id; total = input.amount;
  } else {
    ensure(input.liquidLedgerId === null && input.amount === null, 'INVALID_DOCUMENT', 'Invoices and notes total their lines.', 'amount');
    ensure(Array.isArray(input.lines) && input.lines.length >= 1 && input.lines.length <= 500, 'INVALID_LINES', 'Enter between 1 and 500 lines.', 'lines');
    lines = input.lines.map((line) => {
      const ledger = book.ledgers.find((row) => row.id === line.ledgerId);
      ensure(ledger && ledger.kind === 'general' && !control.has(ledger.id), 'INVALID_LINE_LEDGER', 'Lines use general income/expense ledgers, not cash, bank or party control ledgers.', 'ledgerId');
      return { ledgerId: ledger.id, description: text(line.description, 'description', 200), quantity: line.quantity, unitPrice: line.unitPrice, amount: lineAmount(line.quantity, line.unitPrice) };
    });
    total = minor(lines.reduce((sum, line) => sum + line.amount, 0n));
  }
  let dueDate: string | null = null;
  if (isBill(input.kind)) dueDate = input.dueDate === null ? addDays(input.date, party.creditDays) : businessDate(input.dueDate, 'dueDate');
  else ensure(input.dueDate === null, 'INVALID_DUE_DATE', 'Only invoices carry a due date.', 'dueDate');
  if (dueDate !== null) ensure(dueDate >= input.date, 'INVALID_DUE_DATE', 'Due date must be on or after the document date.', 'dueDate');
  if (isBill(input.kind)) ensure(Array.isArray(input.allocations) && input.allocations.length === 0, 'INVALID_ALLOCATION', 'Invoices are settled by receipts, payments or notes.', 'allocations');
  const side = CONTROL[input.kind]; const other = side === 'debit' ? 'credit' : 'debit';
  const journalLines: LineInput[] = [{ ledgerId: party.controlLedgerId, side, amount: total },
    ...(liquidLedgerId ? [{ ledgerId: liquidLedgerId, side: other, amount: total } as const] : lines.map((line) => ({ ledgerId: line.ledgerId, side: other, amount: line.amount }) as const))];
  const intent = input.kind === 'receipt' ? 'receipt' : input.kind === 'payment' ? 'payment' : 'general';
  const journal = postJournal(book, { tenantId: input.tenantId, companyId: input.companyId, id: journalIdOf(input.id), date: input.date, periodId: input.periodId,
    expectedPeriodVersion: input.expectedPeriodVersion, intent, narration: narration || `${SERIES[input.kind]} ${party.name}`, lines: journalLines }, actorId, createdAt);
  const sequence = state.documents.filter((row) => row.kind === input.kind).length + 1;
  const document: TradeDocument = freeze({ tenantId: input.tenantId, companyId: input.companyId, id: input.id, kind: input.kind, partyId: party.id,
    date: input.date, dueDate, number: `${SERIES[input.kind]}-${String(sequence).padStart(6, '0')}`, acceptedNumber: null, reference, narration, lines,
    liquidLedgerId, total, journalId: journal.id, status: 'posted', voidJournalId: null, voidDate: null });
  const allocations = isBill(input.kind) ? [] : allocate({ ...state, documents: [...state.documents, document] }, document, input.allocations, input.date);
  return freeze({ document, journal, allocations });
}

export function allocateDocument(state: TradeState, sourceId: string, inputs: readonly AllocationInput[], date: string): Allocation[] {
  businessDate(date);
  const source = state.documents.find((row) => row.id === sourceId);
  ensure(source, 'DOCUMENT_NOT_FOUND', 'Settling document must belong to this company.', 'sourceId');
  ensure(inputs.length >= 1, 'INVALID_ALLOCATIONS', 'Enter at least one allocation.', 'allocations');
  return allocate(state, source, inputs, date);
}

export interface VoidInput extends Scope { readonly documentId: string; readonly date: string; readonly periodId: string; readonly expectedPeriodVersion: number; readonly reason: string }

/** Void = full reversal journal; the posted document and journal stay immutable history. */
export function voidDocument(book: BookConfig, state: TradeState, entries: readonly JournalEntry[], input: VoidInput, actorId: string, createdAt: string): { document: TradeDocument; journal: JournalEntry } {
  sameScope(book.company, input);
  const document = state.documents.find((row) => row.id === input.documentId);
  ensure(document, 'DOCUMENT_NOT_FOUND', 'Document must belong to this company.', 'documentId');
  ensure(document.status === 'posted', 'DOCUMENT_VOIDED', 'Document is already voided.', 'documentId');
  if (isBill(document.kind)) ensure(outstanding(state, document) === document.total, 'DOCUMENT_ALLOCATED', 'Release settlements against this bill before voiding it.', 'documentId');
  const original = entries.find((row) => row.id === document.journalId);
  ensure(original, 'JOURNAL_NOT_FOUND', 'Document journal is missing.');
  const journal = reverseJournal(book, original, { tenantId: input.tenantId, companyId: input.companyId, id: voidJournalIdOf(document.id), date: input.date,
    periodId: input.periodId, expectedPeriodVersion: input.expectedPeriodVersion, narration: text(input.reason, 'reason', 2000) }, actorId, createdAt);
  return { document: freeze({ ...document, status: 'voided', voidJournalId: journal.id, voidDate: journal.date }), journal };
}

/** Structural invariants for any stored trade state against its journals; used by every commit. */
export function checkTrade(book: BookConfig, state: TradeState, entries: readonly JournalEntry[]): void {
  checkParties(book, state.parties);
  const control = controlLedgers(state); const ids = new Set<string>(); const numbers = new Set<string>(); const owned = new Set<string>();
  for (const document of state.documents) {
    sameScope(book.company, document);
    ensure(!ids.has(document.id), 'DUPLICATE_DOCUMENT', 'Document IDs must be unique.'); ids.add(document.id);
    ensure(!numbers.has(document.kind + document.number), 'DUPLICATE_NUMBER', 'Document numbers must be unique per series.'); numbers.add(document.kind + document.number);
    const party = state.parties.find((row) => row.id === document.partyId);
    ensure(party && party.role === ROLE[document.kind], 'PARTY_ROLE_MISMATCH', 'Document party is missing or has the wrong role.');
    const journal = entries.find((row) => row.id === document.journalId);
    const control_ = journal?.lines.filter((line) => line.ledgerId === party.controlLedgerId) ?? [];
    ensure(journal && document.journalId === journalIdOf(document.id) && control_.length === 1 && control_[0]!.side === CONTROL[document.kind] && control_[0]!.amount === document.total,
      'DOCUMENT_JOURNAL_MISMATCH', 'Document must link one balanced journal posting its total to the party control ledger.');
    owned.add(journal.id);
    if (document.status === 'voided') {
      const reversal = entries.find((row) => row.id === document.voidJournalId);
      ensure(reversal && reversal.reverses === journal.id && reversal.date === document.voidDate, 'DOCUMENT_JOURNAL_MISMATCH', 'Voided document must link its reversal.');
      owned.add(reversal.id);
    } else ensure(document.voidJournalId === null && document.voidDate === null, 'DOCUMENT_JOURNAL_MISMATCH', 'Posted document cannot carry void details.');
  }
  for (const allocation of state.allocations) {
    sameScope(book.company, allocation);
    const source = state.documents.find((row) => row.id === allocation.sourceId); const target = state.documents.find((row) => row.id === allocation.targetId);
    ensure(source && target && !isBill(source.kind) && isBill(target.kind) && source.partyId === target.partyId && allocation.amount > 0n &&
      allocation.date >= source.date && allocation.date >= target.date, 'INVALID_ALLOCATION', 'Stored allocation links an invalid settlement.');
  }
  for (const document of state.documents) ensure(outstanding(state, document) >= 0n, 'OVER_ALLOCATION', 'Stored allocations exceed a document amount.');
  for (const entry of entries) {
    if (owned.has(entry.id)) continue;
    ensure(entry.lines.every((line) => !control.has(line.ledgerId)), 'CONTROL_LEDGER_RESERVED', 'Party control ledgers accept postings only from sales/purchase documents.', 'ledgerId');
  }
}

export interface PartyBalance { readonly partyId: string; readonly partyName: string; readonly role: PartyRole; readonly controlLedgerId: string; readonly balance: bigint }

/** Signed balances (debit positive). Each control ledger's journal balance must equal the sum of its parties. */
export function partyBalances(book: BookConfig, state: TradeState, entries: readonly JournalEntry[], asOf: string) {
  businessDate(asOf, 'asOf');
  const parties: PartyBalance[] = state.parties.map((party) => ({ partyId: party.id, partyName: party.name, role: party.role, controlLedgerId: party.controlLedgerId,
    balance: state.documents.filter((row) => row.partyId === party.id && live(row, asOf)).reduce((sum, row) => sum + (CONTROL[row.kind] === 'debit' ? row.total : -row.total), 0n) }));
  const controls = [...controlLedgers(state)].map((ledgerId) => {
    const ledger = entries.filter((entry) => entry.date <= asOf).flatMap((entry) => entry.lines).filter((line) => line.ledgerId === ledgerId)
      .reduce((sum, line) => sum + (line.side === 'debit' ? line.amount : -line.amount), 0n);
    const subledger = parties.filter((row) => row.controlLedgerId === ledgerId).reduce((sum, row) => sum + row.balance, 0n);
    ensure(ledger === subledger, 'CONTROL_MISMATCH', 'Party balances do not reconcile to their control ledger.');
    return { ledgerId, ledgerName: book.ledgers.find((row) => row.id === ledgerId)?.name ?? ledgerId, balance: ledger };
  });
  return freeze({ asOf, parties, controls });
}

export const AGING_BUCKETS = ['current', '1-30', '31-60', '61-90', 'over-90'] as const;
export type AgingBucket = typeof AGING_BUCKETS[number];

function daysBetween(from: string, to: string): number {
  return Math.round((Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10)) - Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10))) / 86400000);
}

/** Open bills by days past due; unallocated settlements are listed as on-account credits. Totals tie to party balances. */
export function aging(book: BookConfig, state: TradeState, entries: readonly JournalEntry[], role: PartyRole, asOf: string) {
  const balances = partyBalances(book, state, entries, asOf);
  const bills = state.documents.filter((row) => isBill(row.kind) && ROLE[row.kind] === role).map((document) => {
    const open = outstanding(state, document, asOf);
    const overdue = daysBetween(document.dueDate!, asOf);
    const bucket: AgingBucket = overdue <= 0 ? 'current' : overdue <= 30 ? '1-30' : overdue <= 60 ? '31-60' : overdue <= 90 ? '61-90' : 'over-90';
    return { documentId: document.id, number: document.number, partyId: document.partyId, date: document.date, dueDate: document.dueDate!, daysOverdue: Math.max(0, overdue), bucket, outstanding: open };
  }).filter((row) => row.outstanding > 0n);
  const credits = state.documents.filter((row) => !isBill(row.kind) && ROLE[row.kind] === role)
    .map((document) => ({ documentId: document.id, number: document.number, partyId: document.partyId, date: document.date, unallocated: outstanding(state, document, asOf) }))
    .filter((row) => row.unallocated > 0n);
  const buckets = Object.fromEntries(AGING_BUCKETS.map((bucket) => [bucket, bills.filter((row) => row.bucket === bucket).reduce((sum, row) => sum + row.outstanding, 0n)])) as Record<AgingBucket, bigint>;
  const net = bills.reduce((sum, row) => sum + row.outstanding, 0n) - credits.reduce((sum, row) => sum + row.unallocated, 0n);
  const sign = role === 'customer' ? 1n : -1n;
  const expected = balances.parties.filter((row) => row.role === role).reduce((sum, row) => sum + row.balance, 0n) * sign;
  ensure(net === expected, 'AGING_MISMATCH', 'Aging does not reconcile to party balances.');
  return freeze({ asOf, role, bills, credits, buckets, net });
}
