import { AccountingError, defineBook, freeze } from '@erp/domain';
import type { BookConfig, Scope } from '@erp/domain';
import type { BookState, BookStore } from './contracts.js';
import { validateCommit } from './commit.js';

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
