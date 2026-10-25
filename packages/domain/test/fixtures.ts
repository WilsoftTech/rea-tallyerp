import { currency, defineBook } from '../src/index.js';
import type { BookConfig, JournalInput, LineInput, Scope } from '../src/index.js';

export const scope: Scope = { tenantId: 'tenant-a', companyId: 'company-a' };
export const cash: LineInput = { ledgerId: 'cash', side: 'debit', amount: 1000n };
export const equity: LineInput = { ledgerId: 'equity', side: 'credit', amount: 1000n };
export const at = '2026-01-15T12:00:00.000Z';
export function configuration(overrides: Partial<BookConfig> = {}): BookConfig {
  return defineBook({
    company: { ...scope, name: 'Synthetic Engine Lab', currency: currency('UGX', 0), booksFrom: '2026-01-01' },
    years: [{ ...scope, id: 'fy26', start: '2026-01-01', end: '2026-12-31' }],
    periods: [
      { ...scope, id: 'jan', yearId: 'fy26', start: '2026-01-01', end: '2026-01-31', status: 'open', version: 1 },
      { ...scope, id: 'feb', yearId: 'fy26', start: '2026-02-01', end: '2026-02-28', status: 'open', version: 1 },
    ],
    groups: ['asset', 'liability', 'equity', 'income', 'expense'].map((nature) => ({ ...scope, id: nature, name: nature, nature: nature as 'asset' | 'liability' | 'equity' | 'income' | 'expense', parentId: null })),
    ledgers: [
      { ...scope, id: 'cash', name: 'Cash', groupId: 'asset', kind: 'cash' },
      { ...scope, id: 'bank', name: 'Bank', groupId: 'asset', kind: 'bank' },
      { ...scope, id: 'receivable', name: 'Receivable', groupId: 'asset', kind: 'general' },
      { ...scope, id: 'payable', name: 'Payable', groupId: 'liability', kind: 'general' },
      { ...scope, id: 'equity', name: 'Equity', groupId: 'equity', kind: 'general' },
      { ...scope, id: 'revenue', name: 'Revenue', groupId: 'income', kind: 'general' },
      { ...scope, id: 'expense', name: 'Expense', groupId: 'expense', kind: 'general' },
    ], ...overrides,
  });
}
export function journal(overrides: Partial<JournalInput> = {}): JournalInput {
  return { ...scope, id: 'j1', date: '2026-01-15', periodId: 'jan', expectedPeriodVersion: 1,
    intent: 'general', narration: 'Synthetic fixture', lines: [cash, equity], ...overrides };
}
