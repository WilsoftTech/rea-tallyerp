import { businessDate, contains, dateRange } from './calendar.js';
import type { DateRange } from './calendar.js';
import { ensure, freeze, identifier } from './errors.js';
import { currency } from './money.js';
import type { Currency } from './money.js';

export interface Scope { readonly tenantId: string; readonly companyId: string }
export type Nature = 'asset' | 'liability' | 'equity' | 'income' | 'expense';
export interface Company extends Scope { readonly name: string; readonly currency: Currency; readonly booksFrom: string }
export interface FinancialYear extends Scope, DateRange { readonly id: string }
export interface FinancialPeriod extends Scope, DateRange {
  readonly id: string; readonly yearId: string; readonly status: 'open' | 'locked'; readonly version: number;
}
export interface AccountGroup extends Scope {
  readonly id: string; readonly name: string; readonly nature: Nature; readonly parentId: string | null;
}
export interface Ledger extends Scope {
  readonly id: string; readonly name: string; readonly groupId: string; readonly kind: 'general' | 'cash' | 'bank';
}
export interface BookConfig {
  readonly company: Company;
  readonly years: readonly FinancialYear[];
  readonly periods: readonly FinancialPeriod[];
  readonly groups: readonly AccountGroup[];
  readonly ledgers: readonly Ledger[];
}

export function checkScope(scope: Scope): void {
  identifier(scope.tenantId, 'tenantId'); identifier(scope.companyId, 'companyId');
}
export function sameScope(expected: Scope, actual: Scope): void {
  checkScope(expected); checkScope(actual);
  ensure(expected.tenantId === actual.tenantId && expected.companyId === actual.companyId,
    'SCOPE_MISMATCH', 'Record belongs to a different tenant or company.');
}
export function label(value: string, field = 'name'): string {
  ensure(typeof value === 'string' && value.trim().length > 0 && value.length <= 200 &&
    [...value].every((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127),
  'INVALID_NAME', 'Use a nonempty name of at most 200 characters.', field);
  return value.trim();
}
export function version(value: number): number {
  ensure(Number.isSafeInteger(value) && value >= 1 && value < Number.MAX_SAFE_INTEGER, 'INVALID_VERSION', 'Expected a positive bounded version.', 'version');
  return value;
}
function distinct(rows: readonly { readonly id: string; readonly name?: string }[], names: boolean): void {
  const ids = new Set<string>(); const labels = new Set<string>();
  for (const row of rows) {
    identifier(row.id, 'id');
    ensure(!ids.has(row.id), 'DUPLICATE_ID', 'Identifiers must be unique within their collection.'); ids.add(row.id);
    if (names && row.name !== undefined) {
      const key = label(row.name).normalize('NFKC').toLowerCase();
      ensure(!labels.has(key), 'DUPLICATE_NAME', 'Names must be unique within this company and collection.', 'name'); labels.add(key);
    }
  }
}
function nonoverlapping(rows: readonly DateRange[]): void {
  const sorted = [...rows].sort((a, b) => a.start.localeCompare(b.start));
  for (let i = 1; i < sorted.length; i++) {
    const prior = sorted[i - 1]; const current = sorted[i];
    ensure(prior && current && current.start > prior.end, 'OVERLAPPING_PERIODS', 'Financial intervals must not overlap.');
  }
}

/** Normalize/copy all supplied configuration; no vendor chart or default currency. */
export function defineBook(input: BookConfig): BookConfig {
  checkScope(input.company);
  const company: Company = { ...input.company, name: label(input.company.name),
    currency: currency(input.company.currency.code, input.company.currency.scale), booksFrom: businessDate(input.company.booksFrom, 'booksFrom') };
  const years = input.years.map((year) => {
    sameScope(company, year); return { ...year, ...dateRange(year.start, year.end) };
  });
  distinct(years, false); nonoverlapping(years);
  const periods = input.periods.map((period) => {
    sameScope(company, period); dateRange(period.start, period.end); version(period.version);
    ensure(period.status === 'open' || period.status === 'locked', 'INVALID_PERIOD_STATUS', 'Period must be open or locked.');
    const year = years.find((row) => row.id === period.yearId);
    ensure(year && contains(year, period.start) && contains(year, period.end), 'PERIOD_OUTSIDE_YEAR', 'Period must belong entirely to its financial year.', 'yearId');
    return { ...period };
  });
  distinct(periods, false); nonoverlapping(periods);
  const groups = input.groups.map((group) => {
    sameScope(company, group);
    ensure(['asset', 'liability', 'equity', 'income', 'expense'].includes(group.nature), 'INVALID_NATURE', 'Select a supported accounting nature.', 'nature');
    return { ...group, name: label(group.name) };
  });
  distinct(groups, true);
  const groupById = new Map(groups.map((group) => [group.id, group]));
  for (const group of groups) {
    const seen = new Set([group.id]); let parentId = group.parentId;
    while (parentId !== null) {
      const parent = groupById.get(parentId);
      ensure(parent, 'GROUP_NOT_FOUND', 'Parent group must belong to this chart.', 'parentId');
      ensure(!seen.has(parent.id), 'GROUP_CYCLE', 'Account groups cannot form a cycle.', 'parentId');
      ensure(parent.nature === group.nature, 'NATURE_MISMATCH', 'Child groups must retain their parent accounting nature.', 'nature');
      seen.add(parent.id); parentId = parent.parentId;
    }
  }
  const ledgers = input.ledgers.map((ledger) => {
    sameScope(company, ledger);
    const group = groupById.get(ledger.groupId);
    ensure(group, 'GROUP_NOT_FOUND', 'Ledger group must belong to this chart.', 'groupId');
    ensure(['general', 'cash', 'bank'].includes(ledger.kind), 'INVALID_LEDGER_KIND', 'Select a supported ledger kind.', 'kind');
    ensure(ledger.kind !== 'cash' || group.nature === 'asset', 'INVALID_LEDGER_KIND', 'Cash ledgers must be asset accounts.', 'kind');
    ensure(ledger.kind !== 'bank' || ['asset', 'liability'].includes(group.nature), 'INVALID_LEDGER_KIND', 'Bank ledgers must be asset or liability accounts.', 'kind');
    return { ...ledger, name: label(ledger.name) };
  });
  distinct(ledgers, true);
  return freeze({ company, years, periods, groups, ledgers });
}
