import { createPrivateKey, createPublicKey, randomUUID, sign } from 'node:crypto';
import { AccountingError, ensure, trialBalance } from '@erp/domain';
import type { Scope } from '@erp/domain';
import { AccountingService, canonical, dispatchCommand } from '@erp/application';
import type { Principal } from '@erp/application';
import { encode, enrollmentSchema, envelopeSchema, json, parse, parseBook, parseCommand, remap, ROLE_PERMISSIONS } from '@erp/contracts';
import type { Grant, Outcome, PullBatch, SignedGrant } from '@erp/contracts';
import type { PrismaClient } from './generated/prisma/client.js';
import { member, tenantOwner } from './auth.js';
import type { Actor, Member } from './auth.js';
import { execute, query, safeCounter } from './db.js';
import type { Tx } from './db.js';
import { lockBook, project, TransactionBookStore } from './book-store.js';

interface Device { id: string; generation: string; user_id: string; source_tenant: string; source_company: string; disabled: boolean }
interface StoredOutcome { command_id: string; payload: string | null; status: Outcome['status']; code: string | null; message: string; cursor: bigint; result: unknown }
const conflictCodes = new Set(['VERSION_CONFLICT', 'PERIOD_LOCKED', 'DATE_OUTSIDE_PERIOD', 'ORIGINAL_NOT_FOUND', 'JOURNAL_NOT_FOUND', 'IDEMPOTENCY_CONFLICT', 'DRAFT_NOT_FOUND']);
function outcome(row: StoredOutcome): Outcome {
  return { protocol: 1, commandId: row.command_id, status: row.status, code: row.code, message: row.message, cursor: safeCounter(row.cursor), result: row.result };
}
export class Cloud {
  private readonly key;
  private readonly publicKey: string;
  constructor(private readonly db: PrismaClient, signingPem: string, private readonly grantSeconds = 86400) {
    ensure(Number.isInteger(grantSeconds) && grantSeconds > 0 && grantSeconds <= 86400, 'CONFIGURATION_REQUIRED', 'Offline posting grants require whole seconds and cannot exceed the approved 24 hours.');
    this.key = createPrivateKey(signingPem);
    ensure(this.key.asymmetricKeyType === 'ed25519', 'CONFIGURATION_REQUIRED', 'An Ed25519 signing key is required.');
    const publicDer = createPublicKey(this.key).export({ type: 'spki', format: 'der' });
    this.publicKey = publicDer.subarray(publicDer.length - 32).toString('base64url');
  }
  private signed(m: Member, d: Device, companyId: string, epoch: string): SignedGrant {
    const issuedAt = Math.floor(Date.now() / 1000);
    const grant: Grant = { protocol: 1, tenantId: m.tenantId, companyId, userId: m.userId, deviceId: d.id, generation: d.generation,
      sourceTenant: d.source_tenant, sourceCompany: d.source_company, epoch,
      permissions: [...ROLE_PERMISSIONS[m.role]], issuedAt, expiresAt: issuedAt + this.grantSeconds, roleVersion: m.version };
    const bytes = Buffer.from(encode(grant));
    return { payload: bytes.toString('base64url'), signature: sign(null, bytes, this.key).toString('base64url'), publicKey: this.publicKey };
  }
  private async device(tx: Tx, m: Member, company: string, id: string, exclusive = false): Promise<Device> {
    const rows = await query<Device>(tx, 'SELECT * FROM devices WHERE tenant_id=$1 AND company_id=$2 AND id=$3 AND user_id=$4 FOR ' + (exclusive ? 'UPDATE' : 'SHARE'), m.tenantId, company, id, m.userId);
    ensure(rows[0], 'DEVICE_NOT_FOUND', 'This device is not enrolled for this cloud company.');
    return rows[0];
  }
  async companies(actor: Actor, tenant: string): Promise<unknown[]> {
    return this.db.$transaction(async (tx) => {
      await member(tx, actor, tenant);
      return query(tx, "SELECT company_id AS id,state::jsonb #>> '{config,company,name}' AS name FROM cloud_books WHERE tenant_id=$1 ORDER BY company_id", tenant);
    });
  }
  async enroll(actor: Actor, tenant: string, raw: unknown): Promise<unknown> {
    const input = parse(enrollmentSchema, raw);
    const original = parseBook(input.book);
    ensure(original.config.company.tenantId === input.sourceTenant && original.config.company.companyId === input.sourceCompany, 'SCOPE_MISMATCH', 'Enrollment source differs from the reviewed book.');
    const fingerprint = canonical({ userId: actor.userId, input });
    return this.db.$transaction(async (tx) => {
      const m = await tenantOwner(tx, actor, tenant);
      ensure(!(await query(tx, 'SELECT 1 FROM enrollment_cancellations WHERE tenant_id=$1 AND id=$2', tenant, input.enrollmentId)).length,
        'ENROLLMENT_CANCELLED', 'This enrollment was explicitly cancelled. Preserve the local book and review a new enrollment or join.');
      const prior = await query<{ payload: string; result: unknown }>(tx, 'SELECT payload,result FROM enrollment_receipts WHERE tenant_id=$1 AND id=$2', tenant, input.enrollmentId);
      if (prior[0]) {
        ensure(prior[0].payload === fingerprint, 'IDEMPOTENCY_CONFLICT', 'Enrollment ID was used for different content.');
        const d = await this.device(tx, m, input.sourceCompany, input.deviceId);
        ensure(d.generation === input.generation && !d.disabled, 'DEVICE_REVOKED', 'Device generation is no longer active.');
        const book = await lockBook(tx, { tenantId: tenant, companyId: input.sourceCompany });
        // Import identity/seed receipt stays immutable. A retry can occur after
        // other devices or recovery advanced the company, so pair the renewed
        // grant with the current canonical epoch/cursor instead of an old frame.
        return { ...(prior[0].result as Record<string, unknown>), epoch: book.epoch, cursor: safeCounter(book.cursor),
          book: json(book.state), grant: this.signed(m, d, input.sourceCompany, book.epoch) };
      }
      const target = { tenantId: tenant, companyId: input.sourceCompany };
      ensure(!(await query(tx, 'SELECT 1 FROM cloud_books WHERE tenant_id=$1 AND company_id=$2', tenant, target.companyId)).length,
        'COMPANY_ALREADY_EXISTS', 'A different reviewed import already created this company. Cancel this attempt and join the existing company separately, or review another organization.');
      const state = remap(original, original.config.company, target);
      const epoch = randomUUID();
      await execute(tx, 'INSERT INTO cloud_books VALUES($1,$2,1,1,$3,$4)', tenant, target.companyId, epoch, encode(state));
      await query(tx, "SELECT set_config('app.import','on',true)");
      await project(tx, null, state);
      await query(tx, "SELECT set_config('app.import','off',true)");
      await execute(tx, 'INSERT INTO devices VALUES($1,$2,$3,$4,$5,$6,$7,false)',
        tenant, target.companyId, input.deviceId, actor.userId, input.generation, input.sourceTenant, input.sourceCompany);
      const d: Device = { id: input.deviceId, user_id: actor.userId, generation: input.generation,
        source_tenant: input.sourceTenant, source_company: input.sourceCompany, disabled: false };
      for (const receipt of state.receipts) await execute(tx,
        "INSERT INTO command_outcomes(tenant_id,company_id,command_id,payload,user_id,device_id,status,code,message,cursor,result) VALUES($1,$2,$3,NULL,$4,$5,'accepted',NULL,'Accepted by explicitly reviewed import',1,$6::jsonb)",
        tenant, target.companyId, receipt.commandId, actor.userId, input.deviceId, encode(receipt.result));
      const imported = trialBalance(state.config, state.entries, '9999-12-31');
      const accepted: Outcome = { protocol: 1, commandId: input.enrollmentId, status: 'accepted', code: null,
        message: 'Company imported after explicit owner review.', cursor: 1, result: { journals: state.entries.length, debit: imported.debit.toString(), credit: imported.credit.toString() } };
      await execute(tx, "INSERT INTO command_outcomes(tenant_id,company_id,command_id,payload,user_id,device_id,status,code,message,cursor,result) VALUES($1,$2,$3,$4,$5,$6,'accepted',NULL,$7,1,$8::jsonb)",
        tenant, target.companyId, input.enrollmentId, fingerprint, actor.userId, input.deviceId, accepted.message, encode(accepted.result));
      await execute(tx, 'INSERT INTO cloud_changes VALUES($1,$2,1,$3,$4,$5::jsonb)', tenant, target.companyId, input.enrollmentId, encode(state), encode(accepted));
      const response = { protocol: 1, tenantId: tenant, companyId: target.companyId, epoch, cursor: 1, book: json(state),
        importedCommandIds: state.receipts.map((r) => r.commandId) };
      await execute(tx, 'INSERT INTO enrollment_receipts VALUES($1,$2,$3,$4::jsonb)', tenant, input.enrollmentId, fingerprint, encode(response));
      return { ...response, grant: this.signed(m, d, target.companyId, epoch) };
    });
  }
  async cancelEnrollment(actor: Actor, tenant: string, id: string, reason: string): Promise<unknown> {
    return this.db.$transaction(async (tx) => {
      await tenantOwner(tx, actor, tenant);
      ensure(!(await query(tx, 'SELECT 1 FROM enrollment_receipts WHERE tenant_id=$1 AND id=$2', tenant, id)).length,
        'ALREADY_ENROLLED', 'This import was accepted. Reconcile its original enrollment response instead of cancelling it.');
      await execute(tx, 'INSERT INTO enrollment_cancellations(tenant_id,id,actor_id,reason) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING', tenant, id, actor.userId, reason);
      return { cancelled: true, enrollmentId: id };
    });
  }
  async renew(actor: Actor, scope: Scope, deviceId: string, generation: string): Promise<SignedGrant> {
    return this.db.$transaction(async (tx) => {
      const m = await member(tx, actor, scope.tenantId, scope.companyId);
      const d = await this.device(tx, m, scope.companyId, deviceId);
      ensure(!d.disabled && d.generation === generation, 'DEVICE_REVOKED', 'Device was revoked or restored; reconcile its generation before resuming.');
      const book = await lockBook(tx, scope);
      return this.signed(m, d, scope.companyId, book.epoch);
    });
  }
  async join(actor: Actor, scope: Scope, input: { deviceId: string; generation: string; sourceTenant: string; sourceCompany: string; confirmed: true }): Promise<unknown> {
    return this.db.$transaction(async (tx) => {
      const m = await member(tx, actor, scope.tenantId, scope.companyId);
      const locked = await lockBook(tx, scope);
      const previous = await query<Device>(tx, 'SELECT * FROM devices WHERE tenant_id=$1 AND company_id=$2 AND id=$3', scope.tenantId, scope.companyId, input.deviceId);
      if (previous[0]) ensure(previous[0].user_id === actor.userId && previous[0].generation === input.generation &&
        previous[0].source_tenant === input.sourceTenant && previous[0].source_company === input.sourceCompany && !previous[0].disabled,
        'DEVICE_CONFLICT', 'Device registration differs. Review or recover its original registration.');
      else await execute(tx, 'INSERT INTO devices VALUES($1,$2,$3,$4,$5,$6,$7,false)', scope.tenantId, scope.companyId, input.deviceId,
        actor.userId, input.generation, input.sourceTenant, input.sourceCompany);
      const d: Device = { id: input.deviceId, user_id: actor.userId, generation: input.generation,
        source_tenant: input.sourceTenant, source_company: input.sourceCompany, disabled: false };
      return { protocol: 1, tenantId: scope.tenantId, companyId: scope.companyId, epoch: locked.epoch,
        cursor: safeCounter(locked.cursor), book: json(locked.state), grant: this.signed(m, d, scope.companyId, locked.epoch) };
    });
  }
  async submit(actor: Actor, scope: Scope, raw: unknown): Promise<Outcome> {
    const input = parse(envelopeSchema, raw);
    // Generation changes do not change a financial command's identity.
    const fingerprint = canonical({ userId: actor.userId, deviceId: input.deviceId, command: input.command, dependencies: input.dependencies, replaces: input.replaces ?? null });
    return this.db.$transaction(async (tx) => {
      const m = await member(tx, actor, scope.tenantId, scope.companyId);
      const d = await this.device(tx, m, scope.companyId, input.deviceId);
      const locked = await lockBook(tx, scope);
      const prior = await query<StoredOutcome>(tx, 'SELECT * FROM command_outcomes WHERE tenant_id=$1 AND company_id=$2 AND command_id=$3', scope.tenantId, scope.companyId, input.command.commandId);
      if (prior[0]) {
        ensure(prior[0].payload === fingerprint, 'IDEMPOTENCY_CONFLICT', 'Command ID was used for different content, actor or source device; inspect the retained receipt.');
        return outcome(prior[0]);
      }
      const store = new TransactionBookStore(locked.state);
      let result: unknown; let status: Outcome['status'] = 'accepted'; let code: string | null = null; let message = 'Accepted by server.';
      try {
        ensure(input.epoch === locked.epoch, 'GENERATION_CONFLICT', 'Server generation changed; reconcile before resuming.');
        ensure(!d.disabled && d.generation === input.generation, 'DEVICE_REVOKED', 'Device generation is no longer authorized.');
        const dependencies = [...input.dependencies];
        const command = parseCommand(input.command);
        if (input.replaces) {
          ensure(command.kind === 'post', 'INVALID_RESOLUTION', 'A replacement must be a new journal.');
          const originals = await query<{ status: string; replaces: string | null }>(tx, 'SELECT status,replaces FROM command_outcomes WHERE tenant_id=$1 AND company_id=$2 AND command_id=$3', scope.tenantId, scope.companyId, input.replaces);
          ensure(originals[0] && originals[0].status !== 'accepted' && originals[0].replaces === null, 'INVALID_RESOLUTION', 'Replacement must link a rejected/conflicting root.');
          ensure(!(await query(tx, "SELECT 1 FROM command_outcomes WHERE tenant_id=$1 AND company_id=$2 AND replaces=$3 AND status='accepted'", scope.tenantId, scope.companyId, input.replaces)).length,
            'ALREADY_RESOLVED', 'This exception already has an accepted replacement.');
        }
        if (command.kind === 'reverse') {
          const original = locked.state.entries.find((e) => e.id === command.originalId);
          ensure(original, 'JOURNAL_NOT_FOUND', 'Original must be cloud-accepted before its reversal.');
        }
        for (const id of dependencies) {
          const accepted = await query<{ status: string }>(tx, 'SELECT status FROM command_outcomes WHERE tenant_id=$1 AND company_id=$2 AND command_id=$3', scope.tenantId, scope.companyId, id);
          ensure(accepted[0]?.status === 'accepted', 'DEPENDENCY_CONFLICT', 'A dependency is not accepted. Resolve it before this command.');
        }
        const translated = remap(command, { tenantId: d.source_tenant, companyId: d.source_company }, scope);
        const principal: Principal = { ...scope, actorId: actor.userId, permissions: ROLE_PERMISSIONS[m.role] };
        result = await dispatchCommand(new AccountingService(store, () => new Date().toISOString()), principal, translated);
        // Once shared, every master identity/classification can be referenced by an
        // offline device, even when the server has not yet seen a posting for it.
        for (const old of locked.state.config.ledgers) {
          const next = store.current.config.ledgers.find((row) => row.id === old.id);
          ensure(next && next.groupId === old.groupId && next.kind === old.kind, 'SHARED_MASTER_IMMUTABLE', 'Shared ledger identities/classifications are append-only.');
        }
        for (const old of locked.state.config.groups) {
          const next = store.current.config.groups.find((row) => row.id === old.id);
          ensure(next && next.parentId === old.parentId && next.nature === old.nature, 'SHARED_MASTER_IMMUTABLE', 'Shared group identities/classifications are append-only.');
        }
        ensure(Buffer.byteLength(encode(store.current)) <= 16 * 1024 * 1024, 'DATA_LIMIT', 'Company exceeds this version’s supported snapshot size.');
        await project(tx, locked.state, store.current);
      } catch (error) {
        // SQL/transient failures abort the whole transaction; stable domain failures retain an outcome.
        if (!(error instanceof AccountingError)) throw error;
        status = conflictCodes.has(error.code) || ['DEPENDENCY_CONFLICT', 'GENERATION_CONFLICT'].includes(error.code) ? 'conflict' : 'rejected';
        code = error.code; message = error.message; result = null;
        store.current = locked.state;
      }
      const cursor = safeCounter(locked.cursor + 1n);
      const response: Outcome = { protocol: 1, commandId: input.command.commandId, status, code, message, cursor, result: json(result) };
      await execute(tx, 'INSERT INTO command_outcomes(tenant_id,company_id,command_id,payload,user_id,device_id,status,code,message,cursor,result,replaces) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12)',
        scope.tenantId, scope.companyId, response.commandId, fingerprint, actor.userId, input.deviceId, status, code, message, BigInt(cursor), encode(response.result), input.replaces ?? null);
      await execute(tx, 'UPDATE cloud_books SET revision=revision+1,cursor=$1,state=$2 WHERE tenant_id=$3 AND company_id=$4',
        BigInt(cursor), encode(store.current), scope.tenantId, scope.companyId);
      await execute(tx, 'INSERT INTO cloud_changes VALUES($1,$2,$3,$4,$5,$6::jsonb)', scope.tenantId, scope.companyId,
        BigInt(cursor), response.commandId, encode(store.current), encode(response));
      return response;
    });
  }
  async receipts(actor: Actor, scope: Scope, ids: readonly string[]): Promise<Outcome[]> {
    return this.db.$transaction(async (tx) => {
      await member(tx, actor, scope.tenantId, scope.companyId);
      const rows = await query<StoredOutcome>(tx, 'SELECT * FROM command_outcomes WHERE tenant_id=$1 AND company_id=$2 AND command_id=ANY($3::text[]) ORDER BY cursor,command_id', scope.tenantId, scope.companyId, [...ids]);
      return rows.map(outcome);
    });
  }
  async pull(actor: Actor, scope: Scope, after: number, epoch: string, limit: number): Promise<PullBatch> {
    ensure(Number.isSafeInteger(after) && after >= 0 && Number.isInteger(limit) && limit >= 1 && limit <= 50, 'INVALID_CURSOR', 'Use a nonnegative cursor and a batch of 1–50.');
    return this.db.$transaction(async (tx) => {
      await member(tx, actor, scope.tenantId, scope.companyId);
      const current = await lockBook(tx, scope);
      ensure(current.epoch === epoch, 'GENERATION_CONFLICT', 'Server generation changed. Preserve local work and reconcile an authorized snapshot.');
      ensure(BigInt(after) <= current.cursor, 'CURSOR_AHEAD', 'Server is behind this device. Recovery review is required.');
      const rows = await query<{ cursor: bigint; outcome: Outcome }>(tx,
        'WITH candidates AS (SELECT cursor,outcome,octet_length(outcome::text) AS bytes FROM cloud_changes WHERE tenant_id=$1 AND company_id=$2 AND cursor>$3 ORDER BY cursor LIMIT $4), bounded AS (SELECT *,sum(bytes) OVER(ORDER BY cursor) AS total,row_number() OVER(ORDER BY cursor) AS n FROM candidates) SELECT cursor,outcome FROM bounded WHERE total<=2097152 OR n=1 ORDER BY cursor',
        scope.tenantId, scope.companyId, BigInt(after), limit);
      if (rows.length) ensure(rows[0]?.cursor === BigInt(after) + 1n && rows.every((row, i) => row.cursor === BigInt(after) + BigInt(i) + 1n),
        'CURSOR_GAP', 'The change feed has a gap. Obtain an authorized recovery snapshot.');
      else ensure(BigInt(after) === current.cursor, 'CURSOR_GAP', 'Expected changes are missing; an authorized snapshot is required.');
      const last = rows.at(-1);
      const snapshot = last ? (await query<{ snapshot: string }>(tx, 'SELECT snapshot FROM cloud_changes WHERE tenant_id=$1 AND company_id=$2 AND cursor=$3', scope.tenantId, scope.companyId, last.cursor))[0]?.snapshot : null;
      if (last) ensure(snapshot, 'CURSOR_GAP', 'Snapshot for the acknowledged cursor is missing.');
      return { protocol: 1, epoch, after, cursor: last ? safeCounter(last.cursor) : after,
        hasMore: last ? last.cursor < current.cursor : false, outcomes: rows.map((r) => r.outcome),
        book: snapshot ? JSON.parse(snapshot) as unknown : json(current.state) };
    });
  }
  async snapshot(actor: Actor, scope: Scope): Promise<unknown> {
    return this.db.$transaction(async (tx) => {
      await member(tx, actor, scope.tenantId, scope.companyId); const current = await lockBook(tx, scope);
      return { protocol: 1, epoch: current.epoch, cursor: safeCounter(current.cursor), book: json(current.state) };
    });
  }
  async recover(actor: Actor, scope: Scope, deviceId: string, generation: string): Promise<unknown> {
    return this.db.$transaction(async (tx) => {
      const m = await member(tx, actor, scope.tenantId, scope.companyId);
      const d = await this.device(tx, m, scope.companyId, deviceId, true);
      ensure(!d.disabled, 'DEVICE_REVOKED', 'Revoked devices require owner review.');
      const locked = await lockBook(tx, scope);
      await execute(tx, 'UPDATE devices SET generation=$1 WHERE tenant_id=$2 AND company_id=$3 AND id=$4',
        generation, scope.tenantId, scope.companyId, deviceId);
      await execute(tx, "INSERT INTO security_audit(tenant_id,id,actor_id,action,reason,details) VALUES($1,$2,$3,'device-generation','Explicit restored-device reconciliation',$4::jsonb)",
        scope.tenantId, randomUUID(), actor.userId, encode({ deviceId, previous: d.generation, generation }));
      return { protocol: 1, epoch: locked.epoch, cursor: safeCounter(locked.cursor), book: json(locked.state),
        grant: this.signed(m, { ...d, generation }, scope.companyId, locked.epoch) };
    });
  }
}
