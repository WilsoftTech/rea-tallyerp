import { expect, test } from 'vitest';
import { AccountingService, InMemoryBookStore } from '@erp/application';
import { trialBalance } from '@erp/domain';
import { encode, json, parseBook, remap } from '../src/index.js';
import { decode, operational } from '../src/codec.js';
import { configuration, journal, scope } from '../../domain/test/fixtures.js';

async function fixture() {
  const store = new InMemoryBookStore(); store.register(configuration());
  const service = new AccountingService(store, () => '2026-01-15T12:00:00.000Z');
  const actor = { ...scope, actorId: 'synthetic-user', permissions: ['post', 'read'] as const };
  await service.post(actor, { kind: 'post', commandId: 'capital', expectedChartVersion: 1, journal: journal() });
  return service.snapshot(actor);
}
test('reviewed import still requires linked immutable receipts/audit and valid historical accounting', async () => {
  const state = await fixture(); expect(parseBook(json(state)).entries).toHaveLength(1);
  expect(() => parseBook(json({ ...state, audit: [] }))).toThrowError(expect.objectContaining({ code: 'INCOMPLETE_POSTING' }));
  expect(() => parseBook(json({ ...state, receipts: [], audit: [] }))).toThrowError(expect.objectContaining({ code: 'INCOMPLETE_POSTING' }));
});
test('operational reports deduplicate accepted IDs, include pending once and exclude durable exceptions', async () => {
  const local = await fixture(); const remote = { tenantId: 'cloud-tenant', companyId: 'cloud-company' };
  const cloud = remap(local, scope, remote);
  const accepted = operational(local, cloud, [{ commandId: 'capital', state: 'accepted', localOnly: false }]);
  expect(accepted.entries).toHaveLength(1); expect(accepted.pending).toBe(0);
  const empty = { ...cloud, entries: [], receipts: [], audit: [] };
  const pending = operational(local, empty, [{ commandId: 'capital', state: 'pending', localOnly: false }]);
  expect(pending.pending).toBe(1); expect(trialBalance(pending.config, pending.entries, '2026-12-31').debit).toBe(1000n);
  expect(operational(local, empty, [{ commandId: 'capital', state: 'conflict', localOnly: false }]).entries).toHaveLength(0);
});
test('report projection refuses a journal identity collision with different accepted financial values', async () => {
  const local = await fixture(); const changed = structuredClone(local);
  changed.entries[0] = { ...changed.entries[0]!, narration: 'Different business content' };
  expect(() => operational(local, changed, [{ commandId: 'capital', state: 'accepted', localOnly: false }])).toThrowError(expect.objectContaining({ code: 'CANONICAL_HISTORY_CONFLICT' }));
  expect(decode(encode(local)).entries[0]?.lines[0]?.amount).toBe(1000n);
});
