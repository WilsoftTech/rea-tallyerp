import assert from 'node:assert/strict';
import { currency, defineBook, trialBalance } from '@erp/domain';
import { AccountingService, InMemoryBookStore } from '@erp/application';

// Real emitted workspace exports, without Vitest's source alias.
const scope = { tenantId: 'smoke-tenant', companyId: 'smoke-company' };
const config = defineBook({
  company: { ...scope, name: 'Synthetic built-package check', currency: currency('TST', 0), booksFrom: '2026-01-01' },
  years: [{ ...scope, id: 'year', start: '2026-01-01', end: '2026-12-31' }],
  periods: [{ ...scope, id: 'period', yearId: 'year', start: '2026-01-01', end: '2026-01-31', status: 'open', version: 1 }],
  groups: [
    { ...scope, id: 'assets', name: 'Assets', nature: 'asset', parentId: null },
    { ...scope, id: 'equity', name: 'Equity', nature: 'equity', parentId: null },
  ],
  ledgers: [
    { ...scope, id: 'cash', name: 'Cash', groupId: 'assets', kind: 'cash' },
    { ...scope, id: 'funding', name: 'Funding', groupId: 'equity', kind: 'general' },
  ],
});
const store = new InMemoryBookStore(); store.register(config);
const service = new AccountingService(store, () => '2026-01-15T00:00:00.000Z');
const actor = { ...scope, actorId: 'smoke-user', permissions: ['post', 'read'] };
const command = { kind: 'post', commandId: 'one', expectedChartVersion: 1, journal: {
  ...scope, id: 'entry', date: '2026-01-01', periodId: 'period', expectedPeriodVersion: 1,
  intent: 'opening', narration: 'Synthetic opening', lines: [
    { ledgerId: 'cash', side: 'debit', amount: 1n },
    { ledgerId: 'funding', side: 'credit', amount: 1n },
  ],
} };
await assert.rejects(service.post(actor, { ...command, journal: { ...command.journal, date: '2026-01-15' } }), { code: 'INVALID_OPENING_DATE' });
await service.post(actor, command);
await service.post(actor, command);
const state = await service.snapshot(actor);
assert.equal(state.entries.length, 1);
assert.equal(state.receipts.length, 1);
assert.equal(state.audit.length, 1);
assert.equal(trialBalance(state.config, state.entries, '2026-01-31').debit, 1n);
console.log('PASS: built Node ESM exports, date rejection, idempotent scoped commit and exact trial balance.');
