import type { AccountGroup, BookConfig, DraftVoucher, FinancialPeriod, FinancialYear, JournalEntry, JournalInput, Ledger, Scope } from '@erp/domain';

export type Permission = 'read' | 'post' | 'reverse' | 'draft' | 'manage-chart' | 'manage-periods' | 'reopen-period';
/** Supplied by a trusted host authorization boundary; this package is not authentication. */
export interface Principal extends Scope { readonly actorId: string; readonly permissions: readonly Permission[] }
export interface AuditEvent extends Scope { readonly commandId: string; readonly actorId: string; readonly action: string; readonly at: string; readonly reason: string }
export type CommandResult = JournalEntry | DraftVoucher | FinancialPeriod | BookConfig;
export interface CommandReceipt extends Scope {
  readonly commandId: string; readonly payload: string; readonly result: CommandResult;
  /** Typed original command retained for versioned outbox delivery; absent only on legacy receipts. */
  readonly command?: FinancialCommand;
}
export interface BookState {
  config: BookConfig;
  chartVersion: number;
  entries: JournalEntry[];
  drafts: DraftVoucher[];
  receipts: CommandReceipt[];
  audit: AuditEvent[];
}
/** Implementations serialize same-book work and commit every effect or none.
 * Work is synchronous, with no network awaits in the transaction.
 */
export interface BookStore {
  transact<T>(scope: Scope, work: (book: BookState) => T): Promise<T>;
  read(scope: Scope): Promise<BookState>;
}
export interface PostCommand { readonly kind: 'post'; readonly commandId: string; readonly expectedChartVersion: number; readonly journal: JournalInput }
export interface ReverseCommand {
  readonly kind: 'reverse'; readonly commandId: string; readonly originalId: string;
  readonly expectedChartVersion: number;
  readonly journal: Omit<JournalInput, 'lines' | 'intent'>;
}
export interface SaveDraftCommand {
  readonly kind: 'save-draft'; readonly commandId: string; readonly draft: JournalInput; readonly expectedDraftVersion: number | null;
  readonly expectedChartVersion: number;
}
export interface PostDraftCommand {
  readonly kind: 'post-draft'; readonly commandId: string; readonly draftId: string; readonly entryId: string;
  readonly expectedDraftVersion: number; readonly expectedPeriodVersion: number;
  readonly expectedChartVersion: number;
}
export interface LockCommand {
  readonly kind: 'period-status'; readonly commandId: string; readonly periodId: string;
  readonly status: 'open' | 'locked'; readonly expectedVersion: number; readonly reason: string;
}
export interface ChartCommand {
  readonly kind: 'replace-chart'; readonly commandId: string; readonly groups: readonly AccountGroup[]; readonly ledgers: readonly Ledger[];
  readonly expectedChartVersion: number;
}
export interface CalendarCommand {
  readonly kind: 'extend-calendar'; readonly commandId: string; readonly expectedChartVersion: number;
  readonly year: FinancialYear; readonly period: FinancialPeriod; readonly reason: string;
}
export type FinancialCommand = PostCommand | ReverseCommand | SaveDraftCommand | PostDraftCommand | LockCommand | ChartCommand | CalendarCommand;
