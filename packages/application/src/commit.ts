import { checkTrade, defineBook, ensure, sameScope, trialBalance, version } from '@erp/domain';
import type { BookState } from './contracts.js';
import { canonical } from './data.js';
import { tradeOf } from './service.js';

export function validateCommit(before: BookState, after: BookState): void {
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
    const receipt = after.receipts.find((row) => 'createdAt' in row.result ? row.result.id === entry.id : 'journalId' in row.result && (row.result.journalId === entry.id || row.result.voidJournalId === entry.id));
    ensure(receipt && after.audit.some((event) => event.commandId === receipt.commandId), 'INCOMPLETE_POSTING', 'Posting requires an atomic receipt and audit record.');
    const period = after.config.periods.find((row) => row.id === entry.periodId);
    ensure(period?.status === 'open' && period.version === entry.periodVersion, 'PERIOD_LOCKED', 'New postings require the current open period.');
    ensure(!entry.reverses || (before.entries.some((row) => row.id === entry.reverses) && after.entries.filter((row) => row.reverses === entry.reverses).length === 1), 'INVALID_REVERSAL', 'Full reversal requires one existing original.');
  }
  const priorTrade = tradeOf(before); const trade = tradeOf(after);
  for (const prior of priorTrade.parties) {
    ensure(trade.parties.some((party) => party.id === prior.id && party.version >= prior.version), 'PARTY_IMMUTABLE', 'Parties cannot be removed or moved to an older version.');
  }
  for (const prior of priorTrade.documents) {
    const next = trade.documents.find((row) => row.id === prior.id);
    const voided = prior.status === 'posted' && next?.status === 'voided' && canonical({ ...next, status: prior.status, voidJournalId: null, voidDate: null }) === canonical(prior);
    ensure(next && (canonical(next) === canonical(prior) || voided), 'POSTED_DOCUMENT_IMMUTABLE', 'Posted documents change only by voiding.');
  }
  for (const prior of priorTrade.allocations) {
    ensure(trade.allocations.some((row) => row.id === prior.id && canonical(row) === canonical(prior)), 'ALLOCATION_IMMUTABLE', 'Allocations are append-only.');
  }
  checkTrade(after.config, trade, after.entries);
  trialBalance(after.config, after.entries, '9999-12-31');
}
