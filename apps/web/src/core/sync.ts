import { AccountingError, ensure, identifier } from '@erp/domain';
import type { JournalEntry } from '@erp/domain';
import { canonical } from '@erp/application';
import type { BookState, FinancialCommand } from '@erp/application';
import { parse, parseBook, parseCommand, parseResult, outcomeSchema, pullSchema, signedGrantSchema, snapshotSchema, roleSchema, z } from '@erp/contracts';
import type { Outcome } from '@erp/contracts';
import { encode, hydrate, remap } from '@erp/contracts/codec';
import { mergeMasters, preserveCanonical, samePosting } from '@erp/contracts/reconcile';
import { all, companyRows, get, put } from './db.js';
import { randomId, verifyGrant } from './crypto.js';
import { service, ServiceError } from './http.js';
import { boundedState, journalResult } from './runtime.js';
import type { BrowserRuntime, CloudLogin } from './runtime.js';
import type { Enrollment, Intent, Profile } from './records.js';
const loginSchema = z.strictObject({ token: z.string().regex(/^[a-f0-9]{64}$/), userId: z.string().min(1).max(100), username: z.string().max(80), expiresAt: z.string(), tenants: z.array(z.strictObject({ id: z.string().min(1).max(100), role: roleSchema })).max(1000) });
const needsReview = ['restored', 'history-conflict', 'recovery-required'];
function outcome(value: unknown): Outcome { const row = parse(outcomeSchema, value); return { ...row, result: row.result }; }
function path(p: Profile, suffix: string): string { return '/v1/tenants/' + p.remoteTenant + '/companies/' + p.remoteCompany + suffix; }
function id(value: unknown): string { return identifier(typeof value === 'string' ? value : '', 'id'); }
function reason(value: unknown): string { ensure(typeof value === 'string' && value.trim().length > 0 && value.length <= 2000, 'REASON_REQUIRED', 'A bounded review reason is required.'); return value; }
export class BrowserSync {
    private loginAttempt = randomId();
    constructor(private readonly core: BrowserRuntime) { }
    invalidateLogin(): void { this.loginAttempt = randomId(); }
    private live(p?: Profile, rebind = false): CloudLogin {
        const current = this.core.cloud;
        ensure(current, 'CLOUD_LOGIN_REQUIRED', 'Sign in to the service to synchronize. Local records are retained.');
        ensure(!p || (current.userId === p.userId && (rebind || current.endpoint === p.endpoint)), 'CLOUD_LOGIN_REQUIRED', 'Sign in with this company’s enrolled service account.');
        return { ...current };
    }
    private sameLive(live: CloudLogin): void { ensure(this.core.cloud?.nonce === live.nonce, 'CLOUD_LOGIN_REQUIRED', 'The service session changed during this request. Its original command is retained for reconciliation.'); }
    private async profile(tx: IDBTransaction, tenant: string, company: string): Promise<Profile> {
        const p = await get(tx, 'profiles', [tenant, company]);
        ensure(p, 'NOT_ENROLLED', 'This company is local-only.');
        ensure(p.tenant === tenant && p.company === company && canonical(p.key) === canonical([tenant, company]) && Number.isSafeInteger(p.version) && p.version > 0, 'INTEGRITY_ERROR', 'Cloud profile scope/version is invalid.');
        return p;
    }
    private next(p: Profile): number { ensure(Number.isSafeInteger(p.version + 1), 'DATA_LIMIT', 'Profile revision reached the supported limit.'); return p.version + 1; }
    private request(live: CloudLogin, where: string, method = 'GET', body?: unknown): Promise<unknown> { return service(live.endpoint, where, method, body, live.token); }
    async run(op: string, token: string, company: string, p: Record<string, unknown>): Promise<unknown> {
        try {
            if (op === 'cloud_login')
                return await this.login(token, p);
            if (op === 'cloud_logout')
                return await this.logout(token);
            if (op === 'cloud_status')
                return await this.status(token, company);
            if (op === 'cloud_companies') {
                const live = this.live();
                return await this.request(live, '/v1/tenants/' + id(p['remoteTenant']) + '/companies');
            }
            if (op === 'cloud_enroll')
                return await this.enroll(token, company, p);
            if (op === 'cloud_cancel_enrollment')
                return await this.cancel(token, company, p);
            if (op === 'cloud_join')
                return await this.join(token, p);
            if (op === 'cloud_designate_compensation')
                return await this.designate(token, company, p);
            if (op === 'cloud_recover') {
                ensure(p['confirmed'] === true, 'REVIEW_REQUIRED', 'Preserve a current backup and confirm recovery reconciliation.');
                return await this.leased(token, company, (profile, live, owner) => this.recover(token, profile, live, owner), true);
            }
            if (op === 'cloud_sync')
                return await this.leased(token, company, (profile, live, owner) => this.synchronize(token, profile, live, owner));
            if (op === 'cloud_command')
                return await this.master(token, company, p['command']);
            if (op === 'cloud_retry_master') {
                const wire = await this.core.transaction(token, ['intents'], 'readonly', async (tx, a) => { const row = await get(tx, 'intents', [a.tenantId, company, id(p['commandId'])]); ensure(row, 'COMMAND_NOT_FOUND', 'Master intent was not found.'); return row.wire; });
                return await this.master(token, company, JSON.parse(wire) as unknown);
            }
            throw new AccountingError('UNSUPPORTED_OPERATION', 'Unsupported browser synchronization operation.');
        }
        catch (cause) {
            if (cause instanceof AccountingError)
                await this.failure(token, company, cause);
            throw cause;
        }
    }
    private async login(token: string, p: Record<string, unknown>): Promise<unknown> {
        this.core.identity(token);
        ensure(p['endpoint'] === this.core.origin, 'INVALID_ENDPOINT', 'This browser uses its configured same-origin accounting service.');
        const attempt = randomId();
        this.loginAttempt = attempt;
        const response = parse(loginSchema, await service(this.core.origin, '/v1/auth/login', 'POST', { username: p['username'], password: p['password'] }));
        const auth = this.core.identity(token);
        ensure(this.loginAttempt === attempt, 'SESSION_CHANGED', 'A newer sign-in, sign-out or lock superseded this login response.');
        id(response.userId);
        for (const t of response.tenants)
            id(t.id);
        await this.core.transaction(token, ['profiles'], 'readwrite', async (tx) => { for (const profile of await all(tx, 'profiles'))
            if (profile.tenant === auth.tenantId && (profile.userId !== response.userId || profile.endpoint !== this.core.origin))
                put(tx, 'profiles', { ...profile, paused: 'signed-out', version: this.next(profile) }); });
        this.core.cloud = { endpoint: this.core.origin, token: response.token, userId: response.userId, tenants: response.tenants, nonce: randomId() };
        this.core.cloudChanged();
        return { endpoint: this.core.origin, userId: response.userId, tenants: response.tenants };
    }
    private async logout(token: string): Promise<unknown> {
        this.invalidateLogin();
        const previous = this.core.cloud;
        this.core.cloud = null;
        await this.core.transaction(token, ['profiles'], 'readwrite', async (tx, a) => { for (const p of await all(tx, 'profiles'))
            if (p.tenant === a.tenantId)
                put(tx, 'profiles', { ...p, paused: 'signed-out', version: this.next(p) }); });
        this.core.cloudChanged();
        if (previous) {
            try {
                await this.request(previous, '/v1/auth/logout', 'POST', {});
            }
            catch { /* live memory cleared even if server logout is interrupted */ }
        }
        return null;
    }
    private publicLive(): unknown { const live = this.core.cloud; return live ? { endpoint: live.endpoint, userId: live.userId, tenants: live.tenants } : null; }
    private async status(token: string, company: string): Promise<unknown> {
        const data = await this.core.transaction(token, ['profiles', 'outbox', 'intents', 'resolutions', 'enrollments'], 'readonly', async (tx, a) => ({
            generation: a.generation, profile: await get(tx, 'profiles', [a.tenantId, company]), pending: await get(tx, 'enrollments', [a.tenantId, company]),
            commands: company ? await companyRows(tx, 'outbox', a.tenantId, company) : [], intents: company ? await companyRows(tx, 'intents', a.tenantId, company) : [], resolutions: company ? await companyRows(tx, 'resolutions', a.tenantId, company) : [],
        }));
        const p = data.profile;
        if (!p)
            return { enrolled: false, session: this.publicLive(), pendingEnrollment: data.pending ? { id: data.pending.enrollmentId, endpoint: data.pending.endpoint, remoteTenant: data.pending.remoteTenant, book: JSON.parse(data.pending.body).book as unknown } : null };
        let permissions: string[] = [];
        let expiresAt: number | null = null;
        let authorityError: unknown = null;
        try {
            const grant = await this.core.authority(p, data.generation);
            permissions = grant.permissions;
            expiresAt = grant.expiresAt;
        }
        catch (cause) {
            authorityError = cause instanceof AccountingError ? { code: cause.code, message: cause.message } : { code: 'UNTRUSTED_GRANT', message: 'Offline authority is invalid; reconnect for review.' };
        }
        return { enrolled: true, session: this.publicLive(), endpoint: p.endpoint, remoteTenant: p.remoteTenant, remoteCompany: p.remoteCompany, cursor: p.cursor, canonical: JSON.parse(p.canonical) as unknown, paused: p.paused, permissions, expiresAt, authorityError,
            commands: data.commands.sort((a, b) => a.sequence - b.sequence).map(d => ({ commandId: d.command, state: d.state, localOnly: d.localOnly, code: d.lastError, cursor: d.serverCursor, replaces: d.root })),
            intents: data.intents.map(i => ({ commandId: i.command, state: i.state, code: i.lastError })), resolutions: data.resolutions.map(r => ({ originalCommand: r.originalCommand, compensation: r.compensation, replacement: r.replacement, root: r.root })) };
    }
    private async makeProfile(token: string, company: string, remoteTenant: string, remoteCompany: string, deviceId: string, generation: string, live: CloudLogin, response: unknown): Promise<Profile> {
        const data = parse(snapshotSchema, response);
        ensure(data.grant && data.tenantId === remoteTenant && data.companyId === remoteCompany, 'SCOPE_MISMATCH', 'Registration response differs from the reviewed company.');
        const auth = this.core.identity(token);
        const book = boundedState(encode(data.book));
        ensure(book.config.company.tenantId === remoteTenant && book.config.company.companyId === remoteCompany, 'SCOPE_MISMATCH', 'Canonical company differs from registration.');
        const p: Profile = { key: [auth.tenantId, company], tenant: auth.tenantId, company, endpoint: this.core.origin, remoteTenant, remoteCompany, userId: live.userId, deviceId, generation, epoch: data.epoch, publicKey: data.grant.publicKey, grant: data.grant, cursor: data.cursor, canonical: encode(book), paused: generation === auth.generation ? null : 'restored', lastSeen: this.core.clock(), lastOnline: this.core.clock(), version: 1, leaseOwner: null, leaseUntil: 0 };
        await verifyGrant(p.grant, p, this.core.clock());
        return p;
    }
    private async enroll(token: string, company: string, input: Record<string, unknown>): Promise<unknown> {
        ensure(input['confirmed'] === true, 'REVIEW_REQUIRED', 'Review the source history and balances before enrollment.');
        const remote = id(input['remoteTenant']);
        const live = this.live();
        const intent = await this.core.transaction(token, ['books', 'outbox', 'profiles', 'enrollments'], 'readwrite', async (tx, a) => {
            this.sameLive(live);
            const source = await this.core.source(tx, a.tenantId, company);
            ensure(!source.profile, 'ALREADY_ENROLLED', 'Company is already enrolled. Synchronize or reconcile recovery.');
            const prior = await get(tx, 'enrollments', [a.tenantId, company]);
            if (prior) {
                ensure(prior.endpoint === live.endpoint && prior.remoteTenant === remote, 'ENROLLMENT_PENDING', 'Retry the original reviewed target or cancel it with that service.');
                return prior;
            }
            const row: Enrollment = { key: [a.tenantId, company], tenant: a.tenantId, company, endpoint: live.endpoint, remoteTenant: remote, enrollmentId: randomId(), deviceId: randomId(), generation: a.generation, body: '' };
            row.body = encode({ protocol: 1, enrollmentId: row.enrollmentId, deviceId: row.deviceId, generation: row.generation, sourceTenant: a.tenantId, sourceCompany: company, confirmed: true, book: source.state });
            put(tx, 'enrollments', row);
            return row;
        });
        const response = await this.request(live, '/v1/tenants/' + remote + '/companies', 'POST', JSON.parse(intent.body) as unknown);
        const p = await this.makeProfile(token, company, remote, company, intent.deviceId, intent.generation, live, response);
        const seed = (JSON.parse(intent.body) as {
            book: unknown;
        }).book;
        const seeded = parseBook(seed);
        await this.core.transaction(token, ['books', 'outbox', 'profiles', 'enrollments', 'events'], 'readwrite', async (tx, a) => {
            this.sameLive(live);
            const pending = await get(tx, 'enrollments', [a.tenantId, company]);
            ensure(pending?.enrollmentId === intent.enrollmentId, 'ENROLLMENT_CHANGED', 'Original enrollment intent changed during its response.');
            const source = await this.core.source(tx, a.tenantId, company);
            ensure(!source.profile, 'ALREADY_ENROLLED', 'Another tab already reconciled enrollment.');
            const canonicalBook = boundedState(p.canonical);
            const next = mergeMasters(source.state, canonicalBook, { tenantId: p.remoteTenant, companyId: p.remoteCompany });
            put(tx, 'books', { ...source.row, state: encode(next), revision: source.row.revision + 1 });
            put(tx, 'profiles', p);
            const seedIds = new Set(seeded.receipts.map(r => r.commandId));
            for (const row of source.deliveries)
                put(tx, 'outbox', seedIds.has(row.command) ? { ...row, state: 'accepted', serverCursor: 1 } : { ...row, state: row.localOnly ? row.state : 'pending' });
            tx.objectStore('enrollments').delete(intent.key);
            this.core.event(tx, a.tenantId, company, 'enrolled', 'Reviewed import ' + intent.enrollmentId + ' and pinned service key');
        });
        this.core.notify();
        return this.status(token, company);
    }
    private async cancel(token: string, company: string, input: Record<string, unknown>): Promise<unknown> {
        ensure(input['confirmed'] === true, 'REVIEW_REQUIRED', 'Confirm cancellation of the original pending import.');
        const why = reason(input['reason']);
        const live = this.live();
        const row = await this.core.transaction(token, ['enrollments'], 'readonly', async (tx, a) => { const pending = await get(tx, 'enrollments', [a.tenantId, company]); ensure(pending, 'NOT_ENROLLING', 'There is no pending enrollment to cancel.'); ensure(pending.endpoint === live.endpoint, 'INVALID_ENDPOINT', 'Use the original enrollment service before cancelling.'); return pending; });
        const response = await this.request(live, '/v1/tenants/' + row.remoteTenant + '/enrollments/' + row.enrollmentId + '/cancel', 'POST', { confirmed: true, reason: why }) as {
            cancelled?: unknown;
            enrollmentId?: unknown;
        };
        ensure(response.cancelled === true && response.enrollmentId === row.enrollmentId, 'INVALID_SERVICE_RESPONSE', 'Cancellation was not acknowledged for the original intent.');
        await this.core.transaction(token, ['enrollments', 'events'], 'readwrite', async (tx, a) => { this.sameLive(live); const pending = await get(tx, 'enrollments', row.key); ensure(pending?.enrollmentId === row.enrollmentId, 'ENROLLMENT_CHANGED', 'Enrollment changed during cancellation.'); tx.objectStore('enrollments').delete(row.key); this.core.event(tx, a.tenantId, company, 'enrollment-cancelled', why); });
        this.core.notify();
        return null;
    }
    private async join(token: string, input: Record<string, unknown>): Promise<unknown> {
        ensure(input['confirmed'] === true, 'REVIEW_REQUIRED', 'Confirm joining as a separate local source book.');
        const tenant = id(input['remoteTenant']), company = id(input['remoteCompany']), live = this.live();
        const row = await this.core.transaction(token, ['profiles', 'joins'], 'readwrite', async (tx, a) => {
            this.sameLive(live);
            ensure(!(await all(tx, 'profiles')).some(p => p.tenant === a.tenantId && p.endpoint === live.endpoint && p.userId === live.userId && p.remoteTenant === tenant && p.remoteCompany === company), 'ALREADY_ENROLLED', 'This cloud company is already linked on this browser.');
            const key: [
                string,
                string,
                string,
                string
            ] = [a.tenantId, tenant, company, live.userId];
            let prior = await get(tx, 'joins', key);
            if (!prior) {
                prior = { key, tenant: a.tenantId, remoteTenant: tenant, remoteCompany: company, userId: live.userId, localCompany: randomId(), deviceId: randomId(), generation: a.generation };
                put(tx, 'joins', prior);
            }
            return prior;
        });
        const response = await this.request(live, '/v1/tenants/' + tenant + '/companies/' + company + '/join', 'POST', { deviceId: row.deviceId, generation: row.generation, sourceTenant: row.tenant, sourceCompany: row.localCompany, confirmed: true });
        const p = await this.makeProfile(token, row.localCompany, tenant, company, row.deviceId, row.generation, live, response);
        const accepted = boundedState(p.canonical);
        const config = remap(accepted.config, { tenantId: tenant, companyId: company }, { tenantId: row.tenant, companyId: row.localCompany });
        const state: BookState = { config, chartVersion: accepted.chartVersion, entries: [], drafts: [], receipts: [], audit: [] };
        parseBook(JSON.parse(encode(state)) as unknown);
        await this.core.transaction(token, ['books', 'profiles', 'joins', 'events'], 'readwrite', async (tx, a) => {
            this.sameLive(live);
            ensure(!await get(tx, 'books', [a.tenantId, row.localCompany]), 'ALREADY_ENROLLED', 'Another tab already installed this joined company.');
            put(tx, 'books', { key: [a.tenantId, row.localCompany], tenant: a.tenantId, company: row.localCompany, revision: 1, state: encode(state) });
            put(tx, 'profiles', p);
            tx.objectStore('joins').delete(row.key);
            this.core.event(tx, a.tenantId, row.localCompany, 'joined', 'Registered a separate device source and canonical mirror');
        });
        this.core.notify();
        return { companyId: row.localCompany };
    }
    private async leased<T>(token: string, company: string, work: (p: Profile, live: CloudLogin, owner: string) => Promise<T>, recovery = false): Promise<T> {
        const owner = randomId();
        const planned = await this.core.transaction(token, ['profiles'], 'readwrite', async (tx, a) => {
            const p = await this.profile(tx, a.tenantId, company);
            const live = this.live(p, recovery);
            ensure(recovery || p.generation === a.generation, 'RESTORED_DEVICE', 'Reconcile this restored browser before synchronization.');
            ensure(recovery || !p.paused || !needsReview.includes(p.paused), 'SYNC_REVIEW_REQUIRED', 'Explicit recovery review is required before resuming.');
            ensure(p.leaseUntil <= this.core.clock(), 'SYNC_BUSY', 'Another tab is synchronizing this company. Retry after its lease finishes.');
            put(tx, 'profiles', { ...p, leaseOwner: owner, leaseUntil: this.core.clock() + 60 });
            return { p, live };
        });
        try {
            return await work(planned.p, planned.live, owner);
        }
        finally {
            try {
                await this.core.transaction(token, ['profiles'], 'readwrite', async (tx, a) => { const p = await this.profile(tx, a.tenantId, company); if (p.leaseOwner === owner)
                    put(tx, 'profiles', { ...p, leaseOwner: null, leaseUntil: 0 }); });
            }
            catch { /* restore/lock leaves a bounded reclaimable lease */ }
            this.core.notify();
        }
    }
    private async guarded(tx: IDBTransaction, token: string, planned: Profile, live: CloudLogin, owner: string, recovery = false): Promise<Profile> {
        this.sameLive(live);
        const auth = this.core.identity(token);
        const p = await this.profile(tx, auth.tenantId, planned.company);
        ensure(p.deviceId === planned.deviceId && (recovery || p.generation === auth.generation) && p.leaseOwner === owner, 'SYNC_BUSY', 'Sync identity/lease changed; original commands were preserved.');
        return p;
    }
    private async latest(token: string, company: string): Promise<Profile> { return this.core.transaction(token, ['profiles'], 'readonly', (tx, a) => this.profile(tx, a.tenantId, company)); }
    private async renew(token: string, p: Profile, live: CloudLogin, owner: string): Promise<Profile> {
        const signed = parse(signedGrantSchema, await this.request(live, path(p, '/grant'), 'POST', { deviceId: p.deviceId, generation: p.generation }));
        const grant = await verifyGrant(signed, p, this.core.clock(), true);
        ensure(grant.epoch === p.epoch, 'GENERATION_CONFLICT', 'The server recovery epoch changed. Preserve a backup and reconcile recovery.');
        await this.core.transaction(token, ['profiles'], 'readwrite', async (tx) => {
            const current = await this.guarded(tx, token, p, live, owner);
            ensure(current.version === p.version, 'VERSION_CONFLICT', 'Offline authority changed during renewal. Retry from the persisted state.');
            put(tx, 'profiles', { ...current, grant: signed, paused: null, lastSeen: Math.max(current.lastSeen, this.core.clock()), lastOnline: this.core.clock(), version: this.next(current), leaseUntil: this.core.clock() + 60 });
        });
        return this.latest(token, p.company);
    }
    private async applyOutcome(tx: IDBTransaction, p: Profile, value: Outcome): Promise<void> {
        const row = await get(tx, 'outbox', [p.tenant, p.company, value.commandId]);
        if (row) {
            const source = await get(tx, 'books', [p.tenant, p.company]);
            ensure(source, 'INTEGRITY_ERROR', 'Command source book is absent.');
            const receipt = boundedState(source.state).receipts.find(r => r.commandId === value.commandId);
            ensure(receipt, 'INTEGRITY_ERROR', 'Outbox receipt is absent.');
            if (value.status === 'accepted') {
                const translated = remap(parseResult(value.result), { tenantId: p.remoteTenant, companyId: p.remoteCompany }, { tenantId: p.tenant, companyId: p.company });
                ensure(journalResult(receipt.result) ? journalResult(translated) && samePosting(receipt.result, translated) : canonical(receipt.result) === canonical(translated), 'CANONICAL_HISTORY_CONFLICT', 'Accepted financial result differs from the immutable source command.');
            }
            ensure(row.serverCursor === null || (row.state === value.status && row.serverCursor === value.cursor && row.lastError === value.code), 'CANONICAL_HISTORY_CONFLICT', 'A durable server outcome changed unexpectedly.');
            put(tx, 'outbox', { ...row, state: value.status, serverCursor: value.cursor, lastError: value.code, leaseOwner: null, leaseUntil: 0 });
        }
        const intent = await get(tx, 'intents', [p.tenant, p.company, value.commandId]);
        if (intent)
            put(tx, 'intents', { ...intent, state: value.status, result: encode(value), lastError: value.code });
        if ((row || intent) && value.status !== 'accepted' && ['DEVICE_REVOKED', 'FORBIDDEN', 'GENERATION_CONFLICT'].includes(value.code ?? '')) {
            const current = await this.profile(tx, p.tenant, p.company);
            put(tx, 'profiles', { ...current, paused: value.code === 'DEVICE_REVOKED' ? 'device-revoked' : value.code === 'FORBIDDEN' ? 'access-revoked' : 'recovery-required', version: this.next(current) });
        }
    }
    private async applySnapshot(token: string, p: Profile, live: CloudLogin, owner: string, raw: unknown, cursor: number, epoch: string, outcomes: Outcome[], recovery = false): Promise<void> {
        const cloud = boundedState(encode(raw));
        ensure(cloud.config.company.tenantId === p.remoteTenant && cloud.config.company.companyId === p.remoteCompany, 'SCOPE_MISMATCH', 'Canonical snapshot belongs to another company.');
        ensure(recovery || epoch === p.epoch, 'GENERATION_CONFLICT', 'Server epoch changed; explicit recovery is required.');
        ensure(recovery || cursor >= p.cursor, 'CURSOR_AHEAD', 'Server is behind this browser. Its cursor was not discarded.');
        await this.core.transaction(token, ['profiles', 'books', 'outbox', 'intents', 'enrollments', 'events'], 'readwrite', async (tx, a) => {
            const current = await this.guarded(tx, token, p, live, owner, recovery);
            if (!recovery && current.cursor !== p.cursor) {
                ensure(current.cursor >= cursor, 'CURSOR_CONFLICT', 'Another sync advanced this browser; retry from its saved cursor.');
                return;
            }
            preserveCanonical(boundedState(current.canonical), cloud);
            const source = await this.core.source(tx, a.tenantId, p.company);
            const translated = remap(cloud, { tenantId: p.remoteTenant, companyId: p.remoteCompany }, source.state.config.company);
            for (const entry of source.state.entries) {
                const accepted = translated.entries.find(e => e.id === entry.id);
                ensure(!accepted || samePosting(entry, accepted), 'CANONICAL_HISTORY_CONFLICT', 'A journal ID has different accepted and device values. Neither history was overwritten.');
            }
            const next = mergeMasters(source.state, cloud, { tenantId: p.remoteTenant, companyId: p.remoteCompany });
            if (canonical(next) !== canonical(source.state))
                put(tx, 'books', { ...source.row, state: encode(next), revision: source.row.revision + 1 });
            for (const value of outcomes)
                await this.applyOutcome(tx, current, value);
            const authority = await this.profile(tx, p.tenant, p.company);
            put(tx, 'profiles', { ...authority, canonical: encode(cloud), cursor, epoch, lastSeen: Math.max(current.lastSeen, this.core.clock()), lastOnline: this.core.clock(), leaseUntil: this.core.clock() + 60 });
            if (recovery || current.cursor !== cursor)
                this.core.event(tx, a.tenantId, p.company, recovery ? 'recovery-snapshot' : 'canonical-pull', 'cursor ' + cursor);
        });
    }
    private async pull(token: string, p: Profile, live: CloudLogin, owner: string): Promise<Profile> {
        for (let batch = 0; batch < 100; batch++) {
            const reply = parse(pullSchema, await this.request(live, path(p, '/changes?after=' + p.cursor + '&epoch=' + p.epoch + '&limit=20')));
            ensure(reply.after === p.cursor && reply.cursor >= reply.after, 'INVALID_CURSOR', 'Service change feed differs from the requested cursor.');
            const values = reply.outcomes.map(outcome);
            ensure(values.every((v, i) => v.cursor === p.cursor + i + 1) && (values.length ? reply.cursor === values[values.length - 1]!.cursor : reply.cursor === p.cursor), 'CURSOR_GAP', 'Service changes are not contiguous. Preserve local work and reconcile recovery.');
            await this.applySnapshot(token, p, live, owner, reply.book, reply.cursor, reply.epoch, values);
            p = await this.latest(token, p.company);
            if (!reply.hasMore)
                return p;
            ensure(reply.cursor > reply.after, 'CURSOR_GAP', 'Change feed did not advance.');
        }
        throw new AccountingError('SYNC_BATCH_LIMIT', 'More changes remain. Synchronize again from the saved cursor.');
    }
    private dependencies(state: BookState, command: FinancialCommand): string[] {
        const target = command.kind === 'reverse' ? command.originalId : command.kind === 'post-draft' ? command.draftId : null;
        if (!target)
            return [];
        return state.receipts.filter(r => 'id' in r.result && r.result.id === target && (command.kind !== 'post-draft' || ('version' in r.result && r.result.version === command.expectedDraftVersion))).map(r => r.commandId);
    }
    private packet(p: Profile, source: BookState, command: FinancialCommand, root: string | null = null): unknown { return { protocol: 1, deviceId: p.deviceId, generation: p.generation, epoch: p.epoch, command, dependencies: this.dependencies(source, command), replaces: root }; }
    private async synchronize(token: string, p: Profile, live: CloudLogin, owner: string): Promise<unknown> {
        p = await this.renew(token, p, live, owner);
        p = await this.pull(token, p, live, owner);
        for (let attempt = 0; attempt < 100; attempt++) {
            const next = await this.core.transaction(token, ['profiles', 'books', 'outbox', 'enrollments'], 'readwrite', async (tx, a) => {
                const current = await this.guarded(tx, token, p, live, owner);
                const source = await this.core.source(tx, a.tenantId, p.company);
                const row = source.deliveries.filter(d => !d.localOnly && (d.state === 'pending' || d.state === 'sending')).sort((a, b) => a.sequence - b.sequence)[0];
                if (!row || row.nextAttempt > this.core.clock() || (row.state === 'sending' && row.leaseUntil > this.core.clock()))
                    return null;
                ensure(row.wire, 'WIRE_COMMAND_REQUIRED', 'An old command needs reviewed import; no financial payload was reconstructed.');
                const command = parseCommand(JSON.parse(row.wire) as unknown);
                put(tx, 'outbox', { ...row, state: 'sending', attempts: row.attempts + 1, leaseOwner: owner, leaseUntil: this.core.clock() + 60 });
                put(tx, 'profiles', { ...current, leaseUntil: this.core.clock() + 60 });
                return { row, packet: this.packet(current, source.state, command, row.root) };
            });
            if (!next)
                break;
            let reply: Outcome;
            try {
                reply = outcome(await this.request(live, path(p, '/commands'), 'POST', next.packet));
                ensure(reply.commandId === next.row.command, 'INVALID_SERVICE_RESPONSE', 'Service acknowledgment belongs to another command.');
            }
            catch (cause) {
                await this.core.transaction(token, ['outbox'], 'readwrite', async (tx, a) => { const row = await get(tx, 'outbox', [a.tenantId, p.company, next.row.command]); if (row?.leaseOwner === owner) {
                    const delay = cause instanceof ServiceError && cause.retryAfter !== null ? cause.retryAfter : Math.min(64, 2 ** Math.min(6, row.attempts)) + crypto.getRandomValues(new Uint8Array(1))[0]! % 3;
                    put(tx, 'outbox', { ...row, state: 'pending', nextAttempt: this.core.clock() + delay, lastError: cause instanceof AccountingError ? cause.code : 'NETWORK_UNAVAILABLE', leaseOwner: null, leaseUntil: 0 });
                } });
                throw cause;
            }
            await this.core.transaction(token, ['profiles', 'books', 'outbox', 'intents', 'events'], 'readwrite', async (tx, a) => {
                const current = await this.guarded(tx, token, p, live, owner);
                const row = await get(tx, 'outbox', [a.tenantId, p.company, reply.commandId]);
                ensure(row?.leaseOwner === owner, 'SYNC_BUSY', 'Delivery lease changed. Reconcile its original receipt on retry.');
                await this.applyOutcome(tx, current, reply);
                this.core.event(tx, a.tenantId, p.company, 'command-outcome', reply.commandId + ' ' + reply.status);
            });
            ensure(!['DEVICE_REVOKED', 'FORBIDDEN', 'GENERATION_CONFLICT'].includes(reply.code ?? ''), reply.code ?? 'COMMAND_REJECTED', reply.message);
        }
        await this.pull(token, await this.latest(token, p.company), live, owner);
        return this.status(token, p.company);
    }
    private async master(token: string, company: string, raw: unknown): Promise<unknown> {
        const command = parseCommand(raw);
        ensure(['replace-chart', 'period-status', 'extend-calendar'].includes(command.kind), 'INVALID_COMMAND', 'Use an online master command for shared chart/calendar/period edits.');
        return this.leased(token, company, async (p, live, owner) => {
            p = await this.renew(token, p, live, owner);
            p = await this.pull(token, p, live, owner);
            const packet = await this.core.transaction(token, ['profiles', 'books', 'outbox', 'intents', 'enrollments'], 'readwrite', async (tx, a) => {
                const current = await this.guarded(tx, token, p, live, owner);
                const source = await this.core.source(tx, a.tenantId, company);
                const key: [
                    string,
                    string,
                    string
                ] = [a.tenantId, company, command.commandId];
                const prior = await get(tx, 'intents', key);
                ensure(!prior || canonical(parseCommand(JSON.parse(prior.wire) as unknown)) === canonical(command), 'IDEMPOTENCY_CONFLICT', 'Retry this command ID with its original payload.');
                if (!prior) {
                    const intent: Intent = { key, tenant: a.tenantId, company, command: command.commandId, wire: encode(command), state: 'pending', result: null, lastError: null };
                    put(tx, 'intents', intent);
                }
                return this.packet(current, source.state, command);
            });
            const reply = outcome(await this.request(live, path(p, '/commands'), 'POST', packet));
            ensure(reply.commandId === command.commandId, 'INVALID_SERVICE_RESPONSE', 'Master acknowledgment belongs to another command.');
            await this.core.transaction(token, ['profiles', 'books', 'outbox', 'intents'], 'readwrite', async (tx) => { const current = await this.guarded(tx, token, p, live, owner); await this.applyOutcome(tx, current, reply); });
            await this.pull(token, p, live, owner);
            ensure(reply.status === 'accepted', reply.code ?? 'COMMAND_REJECTED', reply.message);
            return hydrate(reply.result);
        });
    }
    private async recover(token: string, p: Profile, live: CloudLogin, owner: string): Promise<unknown> {
        const auth = this.core.identity(token);
        const response = parse(snapshotSchema, await this.request(live, path(p, '/recover'), 'POST', { deviceId: p.deviceId, generation: auth.generation, confirmed: true }));
        ensure(response.grant, 'INVALID_SERVICE_RESPONSE', 'Recovery did not supply renewed offline authority.');
        const recovered = { ...p, generation: auth.generation, epoch: response.epoch, endpoint: this.core.origin };
        await verifyGrant(response.grant, recovered, this.core.clock());
        const rows = await this.core.transaction(token, ['outbox'], 'readonly', (tx, a) => companyRows(tx, 'outbox', a.tenantId, p.company));
        const outcomes: Outcome[] = [];
        for (let offset = 0; offset < rows.length; offset += 100) {
            const chunk = rows.slice(offset, offset + 100).filter(d => !d.localOnly);
            if (!chunk.length)
                continue;
            const result = parse(z.array(outcomeSchema).max(100), await this.request(live, path(p, '/receipts'), 'POST', { ids: chunk.map(d => d.command) })).map(outcome);
            for (const row of chunk)
                ensure(!(row.state === 'accepted' && row.serverCursor !== null) || result.some(r => r.commandId === row.command && r.status === 'accepted'), 'CANONICAL_HISTORY_CONFLICT', 'Server recovery is missing a previously accepted receipt. No source history was discarded.');
            outcomes.push(...result);
        }
        await this.applySnapshot(token, p, live, owner, response.book, response.cursor, response.epoch, outcomes, true);
        await this.core.transaction(token, ['profiles', 'outbox'], 'readwrite', async (tx, a) => {
            const current = await this.guarded(tx, token, p, live, owner, true);
            ensure(a.generation === auth.generation, 'RESTORED_DEVICE', 'Vault changed during recovery.');
            put(tx, 'profiles', { ...current, generation: auth.generation, endpoint: this.core.origin, epoch: response.epoch, grant: response.grant!, paused: null, version: this.next(current) });
            for (const row of await companyRows(tx, 'outbox', a.tenantId, p.company))
                if (row.state === 'sending')
                    put(tx, 'outbox', { ...row, state: 'pending', leaseOwner: null, leaseUntil: 0, nextAttempt: 0 });
        });
        return this.status(token, p.company);
    }
    private async designate(token: string, company: string, input: Record<string, unknown>): Promise<unknown> {
        const original = id(input['originalCommand']), reverse = id(input['reversalCommand']), why = reason(input['reason']);
        const p = await this.latest(token, company);
        const auth = this.core.identity(token);
        const grant = await this.core.authority(p, auth.generation);
        ensure(grant.permissions.includes('reverse'), 'FORBIDDEN', 'Reversal permission is required.');
        await this.core.transaction(token, ['profiles', 'books', 'outbox', 'enrollments', 'resolutions', 'events'], 'readwrite', async (tx, a) => {
            const source = await this.core.source(tx, a.tenantId, company);
            ensure(source.profile?.version === p.version, 'VERSION_CONFLICT', 'Authority changed during resolution.');
            const first = source.deliveries.find(d => d.command === original), other = source.deliveries.find(d => d.command === reverse);
            const receipt = source.state.receipts.find(r => r.commandId === original), reversed = source.state.receipts.find(r => r.commandId === reverse);
            ensure(first && other && receipt && reversed && ['rejected', 'conflict'].includes(first.state) && ['rejected', 'conflict'].includes(other.state) && journalResult(receipt.result) && journalResult(reversed.result) && reversed.result.reverses === receipt.result.id && reversed.command?.kind === 'reverse', 'INVALID_RESOLUTION', 'Both commands must be durable exceptions and an exact full source reversal.');
            const cloud = boundedState(p.canonical);
            ensure(!cloud.entries.some(e => e.id === (receipt.result as JournalEntry).id || e.id === (reversed.result as JournalEntry).id), 'INVALID_RESOLUTION', 'Accepted cloud journals require ordinary synchronized reversals.');
            put(tx, 'outbox', { ...other, localOnly: true });
            const key: [
                string,
                string,
                string
            ] = [a.tenantId, company, original];
            if (!await get(tx, 'resolutions', key))
                put(tx, 'resolutions', { key, tenant: a.tenantId, company, root: first.root ?? original, originalCommand: original, compensation: reverse, replacement: null, reason: why });
            this.core.event(tx, a.tenantId, company, 'designated-device-compensation', why);
        });
        this.core.notify();
        return null;
    }
    private async failure(token: string, company: string, cause: AccountingError): Promise<void> {
        if (cause.code === 'AUTHENTICATION_FAILED')
            this.core.cloud = null;
        const pause = cause.code === 'FORBIDDEN' ? 'access-revoked' : cause.code === 'DEVICE_REVOKED' ? 'device-revoked' : cause.code === 'CANONICAL_HISTORY_CONFLICT' ? 'history-conflict' : ['GENERATION_CONFLICT', 'CURSOR_AHEAD', 'CURSOR_GAP', 'MASTER_CONFLICT', 'RESTORED_DEVICE'].includes(cause.code) ? 'recovery-required' : null;
        try {
            if (pause)
                await this.core.transaction(token, ['profiles', 'events'], 'readwrite', async (tx, a) => { const p = await get(tx, 'profiles', [a.tenantId, company]); if (p && p.paused !== pause) {
                    put(tx, 'profiles', { ...p, paused: pause, version: this.next(p) });
                    this.core.event(tx, a.tenantId, company, 'sync-error', cause.code);
                } });
        }
        catch { /* Locked or missing source profile; never invent an outcome. */ }
        this.core.notify();
    }
}
