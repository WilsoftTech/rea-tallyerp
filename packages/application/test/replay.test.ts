import { expect, test } from 'vitest';
import { AccountingService, InMemoryBookStore, replayCommit } from '../src/index.js';
import { configuration, journal, scope } from '../../domain/test/fixtures.js';
const actor = { ...scope, actorId: 'local-owner', permissions: ['read','post','reverse','draft','manage-chart','manage-periods','reopen-period'] as const };
async function fixture() {
  const store = new InMemoryBookStore(); store.register(configuration()); const service = new AccountingService(store, () => '2026-01-15T12:00:00.000Z');
  const before = await service.snapshot(actor);
  await service.post(actor, { kind: 'post', commandId: 'source-post', expectedChartVersion: 1, journal: journal() });
  return { before, after: await service.snapshot(actor) };
}
test('host replay verifies the exact retained command against the same shared engine', async () => {
  const f = await fixture(); await replayCommit(f.before, f.after, actor);
  expect(f.before.entries).toHaveLength(0); expect(f.after.entries).toHaveLength(1);
});
test('a balanced result with different financial values cannot masquerade as its retained command', async () => {
  const f = await fixture(); const changed = structuredClone(f.after);
  changed.entries = [{ ...changed.entries[0]!, lines: changed.entries[0]!.lines.map((l) => ({ ...l, amount: 2000n })) }];
  changed.receipts = [{ ...changed.receipts[0]!, result: changed.entries[0]! }];
  await expect(replayCommit(f.before, changed, actor)).rejects.toMatchObject({ code: 'COMMAND_STATE_MISMATCH' });
});
test('client-controlled actor/permission metadata cannot replace the trusted host actor', async () => {
  const f = await fixture(); await expect(replayCommit(f.before, f.after, { ...actor, actorId: 'different-owner' })).rejects.toMatchObject({ code: 'COMMAND_STATE_MISMATCH' });
});
