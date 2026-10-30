import { AccountingError, defineBook, readMinor } from '@erp/domain';
import type { JournalEntry, Scope } from '@erp/domain';
import { canonical, validateCommit } from '@erp/application';
import type { BookState } from '@erp/application';

export function encode(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => typeof item === 'bigint' ? item.toString() : item);
}
export function json(value: unknown): unknown { return JSON.parse(encode(value)) as unknown; }
export function hydrate<T>(value: unknown): T {
  return JSON.parse(encode(value), (key, item: unknown) => key === 'amount' ? readMinor(item as string) : item) as T;
}
export function decode(text: string): BookState {
  const book = hydrate<BookState>(JSON.parse(text) as unknown); book.config = defineBook(book.config);
  validateCommit(structuredClone(book), book); return book;
}
/** Scope translation preserves original objects and opaque historical receipt payloads. */
export function remap<T>(value: T, from: Scope, to: Scope): T {
  const walk = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(walk);
    if (item && typeof item === 'object') {
      const row = Object.fromEntries(Object.entries(item).map(([key, child]) => [key, walk(child)]));
      if ('tenantId' in row || 'companyId' in row) {
        if (row.tenantId !== from.tenantId || row.companyId !== from.companyId) throw new AccountingError('SCOPE_MISMATCH', 'Record belongs to another enrollment scope.');
        row.tenantId = to.tenantId; row.companyId = to.companyId;
      }
      return row;
    }
    return item;
  };
  return walk(value) as T;
}
export interface Delivery { commandId: string; state: string; localOnly: boolean; code?: string | null; replaces?: string | null }
export function samePosting(a: JournalEntry, b: JournalEntry): boolean {
  const business = (e: JournalEntry) => ({ id: e.id, date: e.date, periodId: e.periodId, yearId: e.yearId, intent: e.intent,
    narration: e.narration, currency: e.currency, reverses: e.reverses,
    lines: e.lines.map(({ ledgerId, side, amount, nature }) => ({ ledgerId, side, amount, nature })) });
  return canonical(business(a)) === canonical(business(b));
}
/** A report view only. Neither immutable history is rewritten or used as a new posting store. */
export function operational(local: BookState, cloud: BookState, deliveries: readonly Delivery[]) {
  const scope = local.config.company;
  const canonical = remap(cloud, cloud.config.company, scope);
  const entries = [...canonical.entries]; const blocked: string[] = []; let pending = 0;
  for (const entry of local.entries) {
    const receipt = local.receipts.find((r) => 'createdAt' in r.result && r.result.id === entry.id);
    const delivery = deliveries.find((d) => d.commandId === receipt?.commandId);
    if (!delivery || delivery.localOnly || !['pending', 'sending', 'accepted'].includes(delivery.state)) continue;
    const known = entries.find((r) => r.id === entry.id);
    if (known) {
      if (!samePosting(known, entry)) throw new AccountingError('CANONICAL_HISTORY_CONFLICT', 'A journal ID has different accepted and device values. Preserve backups and review recovery.');
      continue;
    }
    if (entry.reverses && (!entries.some((r) => r.id === entry.reverses && !r.reverses) || entries.some((r) => r.reverses === entry.reverses))) {blocked.push(entry.id); continue;}
    entries.push(entry); pending++;
  }
  return { config: canonical.config, entries, pending, blocked };
}
