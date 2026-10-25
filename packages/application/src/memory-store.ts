import { AccountingError, defineBook, ensure, freeze, sameScope, trialBalance, version } from '@erp/domain';
import type { BookConfig, Scope } from '@erp/domain';
import type { BookState, BookStore } from './contracts.js';
import { canonical } from './data.js';

function validateCommit(before: BookState, after: BookState): void {
  after.config = defineBook(after.config);
  sameScope(before.config.company, after.config.company);
  ensure(canonical(before.config.company) === canonical(after.config.company), 'COMPANY_IMMUTABLE', 'Registered company/currency/books beginning require a separate migration.');
  version(after.chartVersion);
  const sameChart = canonical([before.config.groups, before.config.ledgers]) === canonical([after.config.groups, after.config.ledgers]);
  ensure(after.chartVersion === before.chartVersion + (sameChart ? 0 : 1), 'VERSION_CONFLICT', 'Chart revision must advance exactly with chart changes.');
  for (const prior of before.entries) {
    ensure(after.entries.some((entry) => entry.id === prior.id && canonical(entry) === canonical(prior)), 'POSTED_JOURNAL_IMMUTABLE', 'Cannot edit or remove a posted journal.');
    const oldPeriod = before.config.periods.find((period) => period.id === prior.periodId);
    const newPeriod = after.config.periods.find((period) => period.id === prior.periodId);
    ensure(oldPeriod && newPeriod && oldPeriod.start === newPeriod.start && oldPeriod.end === newPeriod.end && oldPeriod.yearId === newPeriod.yearId, 'REFERENCED_PERIOD_IMMUTABLE', 'Cannot remove or redefine the range/year of a posted financial period.');
    const oldYear = before.config.years.find((year) => year.id === prior.yearId);
    const newYear = after.config.years.find((year) => year.id === prior.yearId);
    ensure(oldYear && newYear && oldYear.start === newYear.start && oldYear.end === newYear.end, 'REFERENCED_PERIOD_IMMUTABLE', 'Cannot remove or redefine a posted financial year.');
  }
  for (const prior of before.receipts) {
    ensure(after.receipts.some((receipt) => receipt.commandId === prior.commandId && canonical(receipt) === canonical(prior)), 'RECEIPT_IMMUTABLE', 'Cannot edit or remove a command receipt.');
  }
  ensure(before.audit.every((event, index) => after.audit[index] !== undefined && canonical(event) === canonical(after.audit[index])), 'AUDIT_IMMUTABLE', 'Audit history is append-only.');
  for (const prior of before.drafts.filter((draft) => draft.status === 'posted')) {
    ensure(after.drafts.some((draft) => draft.id === prior.id && canonical(draft) === canonical(prior)), 'POSTED_DRAFT_IMMUTABLE', 'Cannot alter a posted source voucher.');
  }
  const receiptIds = new Set<string>();
  for (const receipt of after.receipts) {
    sameScope(after.config.company, receipt);
    ensure(!receiptIds.has(receipt.commandId), 'IDEMPOTENCY_CONFLICT', 'Command receipts must be unique.'); receiptIds.add(receipt.commandId);
  }
  for (const event of after.audit) sameScope(after.config.company, event);
  for (const entry of after.entries.filter((row) => !before.entries.some((prior) => prior.id === row.id))) {
    const receipt = after.receipts.find((row) => 'createdAt' in row.result && row.result.id === entry.id);
    ensure(receipt && after.audit.some((event) => event.commandId === receipt.commandId), 'INCOMPLETE_POSTING', 'Posting requires an atomic receipt and audit record.');
    const period = after.config.periods.find((row) => row.id === entry.periodId);
    ensure(period?.status === 'open' && period.version === entry.periodVersion, 'PERIOD_LOCKED', 'New postings require the current open period.');
    ensure(!entry.reverses || (before.entries.some((row) => row.id === entry.reverses) && after.entries.filter((row) => row.reverses === entry.reverses).length === 1), 'INVALID_REVERSAL', 'Full reversal requires one existing original.');
  }
  trialBalance(after.config, after.entries, '9999-12-31');
}

/** Reference/test adapter only: no disk durability, multi-process safety or auth. */
export class InMemoryBookStore implements BookStore {
  private readonly books = new Map<string, BookState>();
  private readonly queues = new Map<string, Promise<void>>();
  private failCommit = false;
  private key(scope: Scope): string { return JSON.stringify([scope.tenantId, scope.companyId]); }

  register(config: BookConfig): void {
    const validated = defineBook(config); const key = this.key(validated.company);
    if (this.books.has(key)) throw new AccountingError('BOOK_EXISTS', 'Company is already registered.');
    this.books.set(key, { config: validated, chartVersion: 1, entries: [], drafts: [], receipts: [], audit: [] });
  }

  /** One-shot synthetic fault before atomic publication. */
  failNextCommit(): void { this.failCommit = true; }

  async transact<T>(scope: Scope, work: (book: BookState) => T): Promise<T> {
    const key = this.key(scope); const prior = this.queues.get(key) ?? Promise.resolve();
    let release: () => void = () => { /* assigned synchronously by Promise constructor */ };
    const gate = new Promise<void>((resolve) => { release = resolve; });
    this.queues.set(key, gate);
    await prior;
    try {
      const current = this.books.get(key);
      if (!current) throw new AccountingError('BOOK_NOT_FOUND', 'Company is not registered in this scope.');
      const working = structuredClone(current);
      const result = work(working);
      if (result instanceof Promise) throw new AccountingError('ASYNC_TRANSACTION', 'Transaction work must be synchronous.');
      validateCommit(current, working);
      if (this.failCommit) { this.failCommit = false; throw new AccountingError('SYNTHETIC_COMMIT_FAILURE', 'Synthetic commit fault; nothing published.'); }
      const returned = freeze(structuredClone(result));
      const published = structuredClone(working);
      this.books.set(key, published);
      return returned;
    } finally {
      release();
      if (this.queues.get(key) === gate) this.queues.delete(key);
    }
  }

  async read(scope: Scope): Promise<BookState> {
    const key = this.key(scope);
    // Use the same serialization path to make reads consistent with queued writes.
    return this.transact(scope, () => {
      const current = this.books.get(key);
      if (!current) throw new AccountingError('BOOK_NOT_FOUND', 'Company is not registered.');
      return structuredClone(current);
    });
  }
}
