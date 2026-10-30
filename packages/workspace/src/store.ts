import { AccountingError, defineBook, freeze } from '@erp/domain';
import type { BookConfig, Scope } from '@erp/domain';
import { canonical, validateCommit } from '@erp/application';
import type { BookState, BookStore } from '@erp/application';

export type Native = <T>(operation: string, payload?: Record<string, unknown>) => Promise<T>;
import { encode, decode } from '@erp/contracts/codec';
export { encode, decode } from '@erp/contracts/codec';
interface Snapshot { revision: number; state: string }

/** Native CAS is atomic across windows/processes. Work is retried only on a revision conflict. */
export class ClientBookStore implements BookStore {
  constructor(private readonly native: Native, private readonly resolution?: { resolutionMode: 'compensate' | 'replace'; originalCommand: string }) {}
  async register(config: BookConfig): Promise<void> {
    const state: BookState = { config: defineBook(config), chartVersion: 1, entries: [], drafts: [], receipts: [], audit: [] };
    await this.native('create_book', { state: encode(state) });
  }
  async read(scope: Scope): Promise<BookState> {
    const snapshot = await this.native<Snapshot>('read_book', { companyId: scope.companyId });
    const state = decode(snapshot.state);
    if (state.config.company.tenantId !== scope.tenantId || state.config.company.companyId !== scope.companyId)
      throw new AccountingError('SCOPE_MISMATCH', 'Company belongs to another scope.');
    return state;
  }
  async transact<T>(scope: Scope, work: (book: BookState) => T): Promise<T> {
    for (let attempt = 0; attempt < 8; attempt++) {
      const snapshot = await this.native<Snapshot>('read_book', { companyId: scope.companyId });
      const before = decode(snapshot.state);
      if (before.config.company.tenantId !== scope.tenantId || before.config.company.companyId !== scope.companyId)
        throw new AccountingError('SCOPE_MISMATCH', 'Company belongs to another scope.');
      const after = structuredClone(before); const result = work(after);
      if (result instanceof Promise) throw new AccountingError('ASYNC_TRANSACTION', 'Transaction work must be synchronous.');
      validateCommit(before, after);
      const next = encode(after);
      // Read-only snapshots/idempotent replays do not generate writes or outbox records.
      if (canonical(after) === canonical(before)) return freeze(structuredClone(result));
      try {
        await this.native(this.resolution ? 'commit_resolution' : 'commit_book', { companyId: scope.companyId, revision: snapshot.revision, state: next, ...this.resolution });
        return freeze(structuredClone(result));
      } catch (error) {
        if (error instanceof AccountingError && error.code === 'VERSION_CONFLICT' && attempt < 7) continue;
        // A response can be lost after SQLite commits. Confirm the immutable receipt
        // before reporting failure; never issue a replacement financial command.
        const receipt = after.receipts.at(-1);
        if (receipt) {
          try {
            const confirmed = await this.read(scope);
            if (confirmed.receipts.some((r) => r.commandId === receipt.commandId && encode(r) === encode(receipt)))
              return freeze(structuredClone(result));
          } catch { /* keep the original error if confirmation is unavailable */ }
        }
        throw error;
      }
    }
    throw new AccountingError('VERSION_CONFLICT', 'Company is busy. Refresh and try again.');
  }
}
