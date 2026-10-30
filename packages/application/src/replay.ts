import { ensure, sameScope } from '@erp/domain';
import type { BookState, BookStore, Principal } from './contracts.js';
import { canonical } from './data.js';
import { AccountingService } from './service.js';
import { dispatchCommand } from './dispatch.js';
/** Reuse the engine to verify an untrusted client transition before durable CAS.
 * Call outside a live database transaction; the host must recheck revision/authority inside it. */
export async function replayCommit(before: BookState, after: BookState, principal: Principal): Promise<void> {
  const receipt = after.receipts.at(-1); const event = after.audit.at(-1);
  ensure(receipt?.command && event, 'WIRE_COMMAND_REQUIRED', 'A typed command and audit event are required for a new browser commit.');
  const command = receipt.command; const at = event.at; const replay = structuredClone(before);
  const store: BookStore = {
    read: async (scope) => {sameScope(replay.config.company, scope); return structuredClone(replay);},
    transact: async (scope, work) => {sameScope(replay.config.company, scope); return work(replay);},
  };
  await dispatchCommand(new AccountingService(store, () => at), principal, command);
  ensure(canonical(replay) === canonical(after), 'COMMAND_STATE_MISMATCH', 'The committed accounting state must exactly match its retained command and trusted local actor.');
}
