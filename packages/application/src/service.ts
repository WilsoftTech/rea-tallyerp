import { AccountingError, businessDate, contains, defineBook, ensure, freeze, identifier,
  postJournal, reverseJournal, sameScope, timestamp, validateLines, version } from '@erp/domain';
import type { BookConfig, DraftVoucher, FinancialPeriod, JournalEntry } from '@erp/domain';
import type { BookState, BookStore, CalendarCommand, ChartCommand, CommandResult, FinancialCommand, LockCommand,
  Permission, PostCommand, PostDraftCommand, Principal, ReverseCommand, SaveDraftCommand } from './contracts.js';
import { canonical } from './data.js';

function authorize(context: Principal, permission: Permission): void {
  identifier(context.actorId, 'actorId'); identifier(context.tenantId, 'tenantId'); identifier(context.companyId, 'companyId');
  ensure(Array.isArray(context.permissions) && context.permissions.every((grant) => ['read', 'post', 'reverse', 'draft', 'manage-chart', 'manage-periods', 'reopen-period'].includes(grant)), 'INVALID_PRINCIPAL', 'Host principal requires an explicit supported permission list.');
  ensure(context.permissions.includes(permission), 'FORBIDDEN', 'Actor is not authorized for this operation.');
}
function append(book: BookState, entry: JournalEntry): JournalEntry {
  ensure(!book.entries.some((row) => row.id === entry.id), 'DUPLICATE_JOURNAL', 'Journal ID already exists.');
  book.entries.push(entry); return entry;
}

export class AccountingService {
  constructor(private readonly store: BookStore, private readonly clock: () => string) {}

  private async execute<R extends CommandResult>(principal: Principal, permission: Permission, input: FinancialCommand,
    apply: (book: BookState, command: FinancialCommand, actor: Principal, at: string) => R): Promise<R> {
    // Capture before queuing: caller mutation cannot alter an in-flight command.
    const actor = freeze(structuredClone(principal));
    const command = freeze(structuredClone(input));
    authorize(actor, permission); identifier(command.commandId, 'commandId');
    const payload = canonical({ actorId: actor.actorId, command });
    return this.store.transact(actor, (book) => {
      sameScope(actor, book.config.company);
      const receipt = book.receipts.find((row) => row.commandId === command.commandId);
      if (receipt) {
        ensure(receipt.payload === payload, 'IDEMPOTENCY_CONFLICT', 'Command ID was already used for different content or actor.');
        // Same canonical discriminated command implies the same result type.
        return freeze(structuredClone(receipt.result)) as R;
      }
      if (command.kind !== 'period-status') {
        ensure(version(command.expectedChartVersion) === book.chartVersion, 'VERSION_CONFLICT', 'Chart changed; refresh before this operation.', 'chartVersion');
      }
      const at = timestamp(this.clock());
      const result = apply(book, command, actor, at);
      book.receipts.push(freeze({ tenantId: actor.tenantId, companyId: actor.companyId, commandId: command.commandId, payload, result, command }));
      book.audit.push(freeze({ tenantId: actor.tenantId, companyId: actor.companyId, commandId: command.commandId, actorId: actor.actorId, action: command.kind, at,
        reason: command.kind === 'period-status' || command.kind === 'extend-calendar' ? command.reason : command.kind === 'reverse' ? command.journal.narration : '' }));
      return result;
    });
  }

  post(principal: Principal, command: PostCommand): Promise<JournalEntry> {
    return this.execute(principal, 'post', command, (book, captured, actor, at) => {
      ensure(captured.kind === 'post', 'INVALID_COMMAND', 'Expected post command.');
      return append(book, postJournal(book.config, captured.journal, actor.actorId, at));
    });
  }

  reverse(principal: Principal, command: ReverseCommand): Promise<JournalEntry> {
    return this.execute(principal, 'reverse', command, (book, captured, actor, at) => {
      ensure(captured.kind === 'reverse', 'INVALID_COMMAND', 'Expected reverse command.');
      const original = book.entries.find((row) => row.id === captured.originalId);
      ensure(original, 'JOURNAL_NOT_FOUND', 'Original journal must belong to this company.');
      ensure(!book.entries.some((row) => row.reverses === original.id), 'ALREADY_REVERSED', 'Original journal already has a full reversal.');
      return append(book, reverseJournal(book.config, original, captured.journal, actor.actorId, at));
    });
  }

  saveDraft(principal: Principal, command: SaveDraftCommand): Promise<DraftVoucher> {
    return this.execute(principal, 'draft', command, (book, captured) => {
      ensure(captured.kind === 'save-draft', 'INVALID_COMMAND', 'Expected draft command.');
      const draft = captured.draft;
      sameScope(book.config.company, draft); identifier(draft.id, 'draftId'); businessDate(draft.date);
      const period = book.config.periods.find((row) => row.id === draft.periodId);
      ensure(period && contains(period, draft.date) && draft.date >= book.config.company.booksFrom, 'DATE_OUTSIDE_PERIOD', 'Draft date must be inside its period and on/after books beginning.', 'date');
      version(draft.expectedPeriodVersion);
      ensure(['general', 'payment', 'receipt', 'transfer', 'opening'].includes(draft.intent), 'INVALID_INTENT', 'Unsupported draft intent.');
      ensure(typeof draft.narration === 'string' && draft.narration.length <= 2000, 'INVALID_NARRATION', 'Draft narration must be bounded text.');
      validateLines(book.config, draft.lines); // Drafts may be incomplete/unbalanced; no effect on books.
      const existing = book.drafts.find((row) => row.id === draft.id);
      ensure(!existing || existing.status === 'draft', 'POSTED_DRAFT_IMMUTABLE', 'Posted source vouchers cannot be edited.');
      ensure(existing ? existing.version === captured.expectedDraftVersion : captured.expectedDraftVersion === null, 'VERSION_CONFLICT', 'Draft changed or already exists.');
      const result = freeze({ ...draft, lines: draft.lines.map((line) => ({ ...line })), version: existing ? version(existing.version + 1) : 1, status: 'draft' as const });
      book.drafts = [...book.drafts.filter((row) => row.id !== draft.id), result];
      return result;
    });
  }

  postDraft(principal: Principal, command: PostDraftCommand): Promise<JournalEntry> {
    return this.execute(principal, 'post', command, (book, captured, actor, at) => {
      ensure(captured.kind === 'post-draft', 'INVALID_COMMAND', 'Expected draft posting command.');
      const draft = book.drafts.find((row) => row.id === captured.draftId);
      ensure(draft, 'DRAFT_NOT_FOUND', 'Draft must belong to this company.');
      ensure(draft.status === 'draft', 'POSTED_DRAFT_IMMUTABLE', 'Draft already posted.');
      ensure(draft.version === captured.expectedDraftVersion, 'VERSION_CONFLICT', 'Draft changed; refresh before posting.');
      const result = append(book, postJournal(book.config, { ...draft, id: captured.entryId, expectedPeriodVersion: captured.expectedPeriodVersion }, actor.actorId, at));
      book.drafts = book.drafts.map((row) => row.id === draft.id ? freeze({ ...row, status: 'posted' as const, version: version(row.version + 1) }) : row);
      return result;
    });
  }

  setPeriodStatus(principal: Principal, command: LockCommand): Promise<FinancialPeriod> {
    return this.execute(principal, command.status === 'open' ? 'reopen-period' : 'manage-periods', command, (book, captured) => {
      ensure(captured.kind === 'period-status', 'INVALID_COMMAND', 'Expected period command.');
      ensure(captured.status === 'open' || captured.status === 'locked', 'INVALID_PERIOD_STATUS', 'Period must be open or locked.');
      ensure(typeof captured.reason === 'string' && captured.reason.trim().length > 0 && captured.reason.length <= 2000, 'REASON_REQUIRED', 'Period changes require a bounded audit reason.');
      const period = book.config.periods.find((row) => row.id === captured.periodId);
      ensure(period, 'PERIOD_NOT_FOUND', 'Period must belong to this company.');
      ensure(period.version === captured.expectedVersion, 'VERSION_CONFLICT', 'Period changed; refresh before changing its status.');
      const changed = freeze({ ...period, status: captured.status, version: version(period.version + 1) });
      book.config = defineBook({ ...book.config, periods: book.config.periods.map((row) => row.id === period.id ? changed : row) });
      return changed;
    });
  }

  replaceChart(principal: Principal, command: ChartCommand): Promise<BookConfig> {
    return this.execute(principal, 'manage-chart', command, (book, captured) => {
      ensure(captured.kind === 'replace-chart', 'INVALID_COMMAND', 'Expected chart command.');
      const next = defineBook({ ...book.config, groups: captured.groups, ledgers: captured.ledgers });
      const used = new Set(book.entries.flatMap((entry) => entry.lines.map((line) => line.ledgerId)));
      for (const ledger of book.config.ledgers.filter((row) => used.has(row.id))) {
        const replacement = next.ledgers.find((row) => row.id === ledger.id);
        ensure(replacement && replacement.groupId === ledger.groupId && replacement.kind === ledger.kind, 'REFERENCED_MASTER_IMMUTABLE', 'Cannot remove/reclassify a posted ledger.');
        let groupId: string | null = ledger.groupId;
        while (groupId !== null) {
          const previous = book.config.groups.find((row) => row.id === groupId);
          const replacementGroup = next.groups.find((row) => row.id === groupId);
          ensure(previous && replacementGroup && previous.parentId === replacementGroup.parentId && previous.nature === replacementGroup.nature, 'REFERENCED_MASTER_IMMUTABLE', 'Cannot remove/reclassify a posted ledger group.');
          groupId = previous.parentId;
        }
      }
      const changed = canonical([book.config.groups, book.config.ledgers]) !== canonical([next.groups, next.ledgers]);
      book.config = next;
      if (changed) book.chartVersion = version(book.chartVersion + 1);
      return next;
    });
  }

  /** Append a financial year and its initial period; existing calendars/history stay intact. */
  extendCalendar(principal: Principal, command: CalendarCommand): Promise<BookConfig> {
    return this.execute(principal, 'manage-periods', command, (book, captured) => {
      ensure(captured.kind === 'extend-calendar', 'INVALID_COMMAND', 'Expected calendar extension command.');
      ensure(typeof captured.reason === 'string' && captured.reason.trim().length > 0 && captured.reason.length <= 2000, 'REASON_REQUIRED', 'Adding a financial year requires a bounded audit reason.');
      ensure(captured.period.yearId === captured.year.id && captured.period.status === 'open' && captured.period.version === 1,
        'INVALID_PERIOD', 'New financial year requires its own open initial period at version one.');
      book.config = defineBook({ ...book.config, years: [...book.config.years, captured.year], periods: [...book.config.periods, captured.period] });
      return book.config;
    });
  }

  async snapshot(principal: Principal): Promise<BookState> {
    const actor = freeze(structuredClone(principal)); authorize(actor, 'read');
    const book = await this.store.read(actor); sameScope(actor, book.config.company);
    return freeze(book);
  }
}

export { AccountingError };
