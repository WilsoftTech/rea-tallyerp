import { hydrate } from './codec.js';
export { encode, json, remap } from './codec.js';
import { z } from 'zod';
export { z };
import { AccountingError, defineBook, ensure, sameScope, timestamp, validateLines } from '@erp/domain';
import type { BookConfig } from '@erp/domain';
import { canonical, validateCommit } from '@erp/application';
import type { BookState, CommandReceipt, FinancialCommand, Permission } from '@erp/application';

export const PROTOCOL = 1 as const;
export const MAX_BODY = 16 * 1024 * 1024;
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/);
const version = z.number().int().positive().max(Number.MAX_SAFE_INTEGER - 1);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const at = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
// Phase 3 form spreads retained these non-authority fields on some scoped rows.
// They are historical metadata only; server principals never derive from them.
const scope = { tenantId: id, companyId: id, actorId: id.optional(),
  permissions: z.array(z.enum(['read', 'post', 'reverse', 'draft', 'manage-chart', 'manage-periods', 'reopen-period'])).max(7).optional() };
const name = z.string().min(1).max(200);
const reason = z.string().min(1).max(2000);
export const permissionSchema = z.enum(['read', 'post', 'reverse', 'draft', 'manage-chart', 'manage-periods', 'reopen-period']);
const unit = z.strictObject({ code: z.string().regex(/^[A-Z]{3}$/), scale: z.number().int().min(0).max(6) });
const nature = z.enum(['asset', 'liability', 'equity', 'income', 'expense']);
const group = z.strictObject({ ...scope, id, name, nature, parentId: id.nullable() });
const ledger = z.strictObject({ ...scope, id, name, groupId: id, kind: z.enum(['general', 'cash', 'bank']) });
const year = z.strictObject({ ...scope, id, start: date, end: date });
const period = year.extend({ yearId: id, status: z.enum(['open', 'locked']), version });
export const configSchema = z.strictObject({
  company: z.strictObject({ ...scope, name, currency: unit, booksFrom: date }),
  years: z.array(year).max(1000), periods: z.array(period).max(10000),
  groups: z.array(group).max(10000), ledgers: z.array(ledger).max(100000),
});
const line = z.strictObject({ ledgerId: id, side: z.enum(['debit', 'credit']), amount: z.string().regex(/^(0|-?[1-9]\d*)$/).max(20) });
const journalFields = {
  ...scope, id, date, periodId: id, expectedPeriodVersion: version,
  intent: z.enum(['general', 'payment', 'receipt', 'transfer', 'opening']), narration: z.string().max(2000),
  lines: z.array(line).max(1000),
};
const journal = z.strictObject(journalFields);
const draft = journal.extend({ version, status: z.enum(['draft', 'posted']) });
const posted = z.strictObject({
  ...scope, id, date, periodId: id, yearId: id, periodVersion: version,
  intent: journalFields.intent, narration: journalFields.narration,
  currency: unit, lines: z.array(line.extend({ ledgerName: name, nature })).min(2).max(1000),
  actorId: id, createdAt: at, reverses: id.nullable(),
});
const base = { commandId: id, expectedChartVersion: version };
export const commandSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...base, kind: z.literal('post'), journal }),
  z.strictObject({ ...base, kind: z.literal('reverse'), originalId: id,
    journal: journal.omit({ lines: true, intent: true }) }),
  z.strictObject({ ...base, kind: z.literal('save-draft'), draft: journal, expectedDraftVersion: version.nullable() }),
  z.strictObject({ ...base, kind: z.literal('post-draft'), draftId: id, entryId: id, expectedDraftVersion: version, expectedPeriodVersion: version }),
  z.strictObject({ kind: z.literal('period-status'), commandId: id, periodId: id,
    status: z.enum(['open', 'locked']), expectedVersion: version, reason }),
  z.strictObject({ ...base, kind: z.literal('replace-chart'), groups: z.array(group).max(10000), ledgers: z.array(ledger).max(100000) }),
  z.strictObject({ ...base, kind: z.literal('extend-calendar'), year, period, reason }),
]);
const result = z.union([posted, draft, period, configSchema]);
export const bookSchema = z.strictObject({
  config: configSchema, chartVersion: version, entries: z.array(posted).max(100000),
  drafts: z.array(draft).max(100000),
  receipts: z.array(z.strictObject({ ...scope, commandId: id, payload: z.string().max(MAX_BODY), result, command: commandSchema.optional() })).max(100000),
  audit: z.array(z.strictObject({ ...scope, commandId: id, actorId: id, action: z.string().max(50), at, reason: z.string().max(2000) })).max(100000),
});
export const envelopeSchema = z.strictObject({
  protocol: z.literal(PROTOCOL), deviceId: id, generation: id, epoch: id,
  command: commandSchema, dependencies: z.array(id).max(100), replaces: id.nullable().optional(),
});
export const enrollmentSchema = z.strictObject({
  protocol: z.literal(PROTOCOL), enrollmentId: id, deviceId: id, generation: id,
  sourceTenant: id, sourceCompany: id, confirmed: z.literal(true), book: bookSchema,
});
export const roleSchema = z.enum(['owner', 'accountant', 'entry', 'viewer']);
export type Role = z.infer<typeof roleSchema>;
export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  owner: ['read', 'post', 'reverse', 'draft', 'manage-chart', 'manage-periods', 'reopen-period'],
  accountant: ['read', 'post', 'reverse', 'draft', 'manage-chart', 'manage-periods'],
  entry: ['read', 'draft'], viewer: ['read'],
};
export const grantSchema = z.strictObject({
  protocol: z.literal(PROTOCOL), tenantId: id, companyId: id, userId: id, deviceId: id, generation: id,
  sourceTenant: id, sourceCompany: id, epoch: id, permissions: z.array(permissionSchema).max(7),
  issuedAt: z.number().int().nonnegative(), expiresAt: z.number().int().nonnegative(), roleVersion: version,
});
export type Envelope = z.infer<typeof envelopeSchema>;
export type Grant = z.infer<typeof grantSchema>;
export interface SignedGrant { payload: string; signature: string; publicKey: string }
export const signedGrantSchema = z.strictObject({ payload: z.string().min(1).max(8192), signature: z.string().min(1).max(128), publicKey: z.string().min(1).max(64) });
export type OutcomeState = 'accepted' | 'rejected' | 'conflict';
export interface Outcome {
  protocol: 1; commandId: string; status: OutcomeState; code: string | null; message: string;
  cursor: number; result: unknown;
}
export interface PullBatch {
  protocol: 1; epoch: string; after: number; cursor: number; hasMore: boolean;
  outcomes: Outcome[]; book: unknown;
}
export const outcomeSchema = z.strictObject({ protocol: z.literal(PROTOCOL), commandId: id, status: z.enum(['accepted','rejected','conflict']), code: z.string().max(100).nullable(), message: z.string().max(2000), cursor: version, result: z.unknown() });
export const pullSchema = z.strictObject({ protocol: z.literal(PROTOCOL), epoch: id, after: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER-1), cursor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER-1), hasMore: z.boolean(), outcomes: z.array(outcomeSchema).max(50), book: z.unknown() });
export const snapshotSchema = z.strictObject({ protocol: z.literal(PROTOCOL), epoch: id, cursor: version, book: z.unknown(), grant: signedGrantSchema.optional(), tenantId: id.optional(), companyId: id.optional(), importedCommandIds: z.array(id).max(100000).optional() });
export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const checked = schema.safeParse(value);
  if (!checked.success) throw new AccountingError('INVALID_PAYLOAD', 'Invalid or unsupported request fields: ' + checked.error.issues[0]?.path.join('.'));
  return checked.data;
}
export function parseCommand(value: unknown): FinancialCommand { return hydrate(parse(commandSchema, value)); }
export function parseResult(value: unknown): CommandReceipt['result'] { return hydrate(parse(result, value)); }
export function parseBook(value: unknown): BookState {
  const book = hydrate<BookState>(parse(bookSchema, value));
  book.config = defineBook(book.config);
  validateCommit(structuredClone(book), book);
  ensure(book.receipts.length === book.audit.length && new Set(book.audit.map((a) => a.commandId)).size === book.audit.length,
    'INCOMPLETE_POSTING', 'Imported receipts require one immutable audit event each.');
  for (const event of book.audit) timestamp(event.at);
  for (const receipt of book.receipts) {
    ensure(book.audit.some((a) => a.commandId === receipt.commandId) && (!receipt.command || receipt.command.commandId === receipt.commandId),
      'INCOMPLETE_POSTING', 'Imported command receipt and audit identities must agree.');
  }
  for (const entry of book.entries) ensure(book.receipts.some((r) => canonical(r.result) === canonical(entry)),
    'INCOMPLETE_POSTING', 'Every imported journal requires its matching immutable receipt.');
  ensure(new Set(book.drafts.map((d) => d.id)).size === book.drafts.length, 'DUPLICATE_DRAFT', 'Draft identities must be unique.');
  for (const draft of book.drafts) {sameScope(book.config.company, draft); validateLines(book.config, draft.lines);}
  return book;
}
export function seed(config: BookConfig): BookState {
  return { config: defineBook(config), chartVersion: 1, entries: [], drafts: [], receipts: [], audit: [] };
}
