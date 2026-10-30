import { ensure, identifier } from '@erp/domain';
import { canonical } from '@erp/application';
import { z, parse, signedGrantSchema, parseCommand, parseBook } from '@erp/contracts';
import { boundedState } from './runtime.js';
import type { Records, Table } from './records.js';
const id = z.string().min(1).max(100).refine(v => { try {
    identifier(v, 'id');
    return true;
}
catch {
    return false;
} });
const counter = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 1);
const key = z.tuple([id, id]);
const commandKey = z.tuple([id, id, id]);
const scope = { tenant: id, company: id };
const endpoint = z.string().url().max(2048).refine(v => { try {
    const u = new URL(v);
    return u.origin === v && (u.protocol === 'https:' || u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname));
}
catch {
    return false;
} });
const credential = z.strictObject({ salt: z.string().regex(/^[A-Za-z0-9_-]{22}$/), iv: z.string().regex(/^[A-Za-z0-9_-]{16}$/), cipher: z.string().regex(/^[A-Za-z0-9_-]+$/).min(32).max(200) });
const optionalId = id.nullable();
const schemas = {
    meta: z.strictObject({ id: z.literal('vault'), tenantId: id, generation: id, credential }),
    books: z.strictObject({ key, ...scope, revision: counter.min(1), state: z.string() }),
    outbox: z.strictObject({ key: commandKey, ...scope, command: id, payload: z.string(), wire: z.string().nullable(), state: z.enum(['not-enrolled', 'pending', 'sending', 'accepted', 'rejected', 'conflict']), sequence: counter, attempts: counter, nextAttempt: counter, leaseUntil: counter, leaseOwner: optionalId, lastError: z.string().max(2000).nullable(), serverCursor: counter.min(1).nullable(), root: optionalId, localOnly: z.boolean() }),
    profiles: z.strictObject({ key, ...scope, endpoint, remoteTenant: id, remoteCompany: id, userId: id, deviceId: id, generation: id, epoch: id, publicKey: z.string().min(1).max(64), grant: signedGrantSchema, cursor: counter.min(1), canonical: z.string(), paused: z.enum(['restored', 'access-revoked', 'device-revoked', 'recovery-required', 'signed-out', 'history-conflict']).nullable(), lastSeen: counter, lastOnline: counter, version: counter.min(1), leaseOwner: optionalId, leaseUntil: counter }),
    intents: z.strictObject({ key: commandKey, ...scope, command: id, wire: z.string(), state: z.enum(['pending', 'accepted', 'rejected', 'conflict']), result: z.string().nullable(), lastError: z.string().max(2000).nullable() }),
    enrollments: z.strictObject({ key, ...scope, endpoint, remoteTenant: id, enrollmentId: id, deviceId: id, generation: id, body: z.string() }),
    joins: z.strictObject({ key: z.tuple([id, id, id, id]), tenant: id, remoteTenant: id, remoteCompany: id, userId: id, localCompany: id, deviceId: id, generation: id }),
    resolutions: z.strictObject({ key: commandKey, ...scope, root: id, originalCommand: id, compensation: id, replacement: optionalId, reason: z.string().min(1).max(2000) }),
    events: z.strictObject({ id, ...scope, at: z.iso.datetime(), action: z.string().min(1).max(100), detail: z.string().max(4000) }),
};
/** Validate metadata before restore can replace any current store. Financial rules remain shared. */
export function validateTables(tables: {
    [K in Table]: Records[K][];
}): void {
    for (const table of Object.keys(schemas) as Table[]) {
        const seen = new Set<string>();
        for (const row of tables[table]) {
            parse<unknown>(schemas[table], row);
            const primary = table === 'meta' || table === 'events' ? (row as Records['meta'] | Records['events']).id : canonical((row as Records['books']).key);
            ensure(!seen.has(primary), 'INVALID_BACKUP', 'Duplicate primary keys are not accepted in a backup.');
            seen.add(primary);
            if ('company' in row) {
                const tail = table === 'outbox' || table === 'intents' ? (row as Records['outbox']).command : table === 'resolutions' ? (row as Records['resolutions']).originalCommand : null;
                if ('key' in row)
                    ensure(canonical(row.key) === canonical(tail ? [row.tenant, row.company, tail] : [row.tenant, row.company]), 'INVALID_BACKUP', 'Backup row keys differ from their scope.');
            }
            if (table === 'intents') {
                const intent = row as Records['intents'];
                const command = parseCommand(JSON.parse(intent.wire) as unknown);
                ensure(command.commandId === intent.command && ['replace-chart', 'period-status', 'extend-calendar'].includes(command.kind), 'INVALID_BACKUP', 'Backup master intent has an invalid command identity.');
            }
            if (table === 'enrollments') {
                const intent = row as Records['enrollments'];
                const body = JSON.parse(intent.body) as Record<string, unknown>;
                const book = parseBook(body['book']);
                ensure(body['protocol'] === 1 && body['confirmed'] === true && body['enrollmentId'] === intent.enrollmentId && body['deviceId'] === intent.deviceId && body['generation'] === intent.generation && body['sourceTenant'] === intent.tenant && body['sourceCompany'] === intent.company && book.config.company.tenantId === intent.tenant && book.config.company.companyId === intent.company, 'INVALID_BACKUP', 'Backup enrollment differs from its original reviewed snapshot.');
            }
            if (table === 'joins') {
                const intent = row as Records['joins'];
                ensure(canonical(intent.key) === canonical([intent.tenant, intent.remoteTenant, intent.remoteCompany, intent.userId]), 'INVALID_BACKUP', 'Backup join key differs from its registration.');
            }
            if (table === 'profiles') {
                const p = row as Records['profiles'];
                const book = boundedState(p.canonical);
                ensure(book.config.company.tenantId === p.remoteTenant && book.config.company.companyId === p.remoteCompany, 'INVALID_BACKUP', 'Backup canonical scope differs from registration.');
            }
        }
    }
}
