import type { AccountGroup, Allocation, AllocationInput, BookConfig, DocumentInput, DraftVoucher, FinancialPeriod, FinancialYear, JournalEntry, JournalInput, Ledger, Party, Scope, TradeDocument } from '@erp/domain';

export type Permission = 'read' | 'post' | 'reverse' | 'draft' | 'manage-chart' | 'manage-periods' | 'reopen-period';
/** Supplied by a trusted host authorization boundary; this package is not authentication. */
export interface Principal extends Scope { readonly actorId: string; readonly permissions: readonly Permission[] }
export interface AuditEvent extends Scope { readonly commandId: string; readonly actorId: string; readonly action: string; readonly at: string; readonly reason: string }
export type CommandResult = JournalEntry | DraftVoucher | FinancialPeriod | BookConfig | Party | TradeDocument | readonly Allocation[];
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
  /** Phase 6 sales/purchase records; absent in books saved before they existed (read as empty). */
  parties?: Party[];
  documents?: TradeDocument[];
  allocations?: Allocation[];
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
export interface SavePartyCommand {
  readonly kind: 'save-party'; readonly commandId: string; readonly party: Omit<Party, 'version'>;
  readonly expectedPartyVersion: number | null; readonly expectedChartVersion: number;
}
export interface PostDocumentCommand { readonly kind: 'post-document'; readonly commandId: string; readonly expectedChartVersion: number; readonly document: DocumentInput }
export interface AllocateCommand {
  readonly kind: 'allocate'; readonly commandId: string; readonly expectedChartVersion: number;
  readonly sourceId: string; readonly date: string; readonly allocations: readonly AllocationInput[];
}
export interface VoidDocumentCommand {
  readonly kind: 'void-document'; readonly commandId: string; readonly expectedChartVersion: number;
  readonly documentId: string; readonly date: string; readonly periodId: string; readonly expectedPeriodVersion: number; readonly reason: string;
}
export type TradeCommand = SavePartyCommand | PostDocumentCommand | AllocateCommand | VoidDocumentCommand;
export type FinancialCommand = PostCommand | ReverseCommand | SaveDraftCommand | PostDraftCommand | LockCommand | ChartCommand | CalendarCommand | TradeCommand;
