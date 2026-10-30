import { AccountingError, defineBook, ensure, identifier } from '@erp/domain';
import type { JournalEntry } from '@erp/domain';
import { canonical, replayCommit, validateCommit } from '@erp/application';
import type { BookState, Principal } from '@erp/application';
import { parseBook, parseCommand } from '@erp/contracts';
import type { Grant } from '@erp/contracts';
import { encode } from '@erp/contracts/codec';
import { LOCAL_PERMISSIONS } from '@erp/workspace/host';
import type { Session } from '@erp/workspace/host';
import type { Native } from '@erp/workspace/store';
import { Database, all, companyRows, get, put } from './db.js';
import { BACKUP_LIMIT, credential, decryptBackup, encryptBackup, now, randomId, unlock, verifyGrant } from './crypto.js';
import type { Book, Delivery, Profile, Records, Table, Vault } from './records.js';
import { TABLES } from './records.js';
import { BrowserSync } from './sync.js';
import { validateTables } from './validation.js';
export interface LocalSession extends Session {
    generation: string;
    touched: number;
}
export interface CloudLogin {
    endpoint: string;
    token: string;
    userId: string;
    tenants: {
        id: string;
        role: string;
    }[];
    nonce: string;
}
interface Source {
    row: Book;
    state: BookState;
    deliveries: Delivery[];
    profile: Profile | undefined;
    enrolling: boolean;
}
interface Backup {
    format: 'ERPWEB01';
    schema: 2;
    tables: {
        [K in Table]: Records[K][];
    };
}
const LIMIT = 16 * 1024 * 1024;
const paused = ['restored', 'access-revoked', 'device-revoked', 'recovery-required', 'signed-out', 'history-conflict'];
export function journalResult(value: unknown): value is JournalEntry { return typeof value === 'object' && value !== null && 'createdAt' in value; }
export function boundedState(value: string): BookState { ensure(typeof value === 'string' && new TextEncoder().encode(value).length <= LIMIT, 'DATA_LIMIT', 'Company exceeds this browser version’s 16 MiB limit.'); return parseBook(JSON.parse(value) as unknown); }
export class BrowserRuntime {
    readonly db: Database;
    readonly sync: BrowserSync;
    cloud: CloudLogin | null = null;
    private session: LocalSession | null = null;
    private onLocked = () => { };
    private channel: BroadcastChannel | null = null;
    private listeners = new Set<() => void>();
    private infoListeners = new Set<() => void>();
    private anchor = { wall: now(), monotonic: performance.now() };
    private failedUntil = 0;
    private unlocking = false;
    private contextStamp = randomId();
    constructor(readonly origin: string, databaseName?: string) {
        this.db = new Database(databaseName, () => { if (this.db.stale)
            this.lock(false); this.infoChanged(); });
        this.sync = new BrowserSync(this);
        if (typeof BroadcastChannel !== 'undefined') {
            this.channel = new BroadcastChannel('erp-workspace-' + this.db.name);
            this.channel.onmessage = (event: MessageEvent<unknown>) => {
                const message = event.data as {
                    kind?: string;
                };
                if (message.kind === 'locked') {
                    this.lock(false);
                }
                if (message.kind === 'cloud-changed') {
                    this.cloud = null;
                    this.notify(false);
                }
                if (message.kind === 'book') {
                    this.notify(false);
                }
            };
        }
    }
    close(): void { this.sync.invalidateLogin(); this.session = null; this.cloud = null; this.db.close(); this.channel?.close(); }
    subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
    subscribeInfo = (listener: () => void): (() => void) => { this.infoListeners.add(listener); return () => { this.infoListeners.delete(listener); }; };
    infoChanged(): void { for (const listener of this.infoListeners)
        listener(); }
    notify(broadcast = true): void { this.contextStamp = randomId(); for (const listener of this.listeners)
        listener(); this.infoChanged(); if (broadcast)
        this.channel?.postMessage({ kind: 'book' }); }
    cloudChanged(): void { this.channel?.postMessage({ kind: 'cloud-changed' }); this.notify(); }
    contextVersion = (): string => this.contextStamp + ':' + (this.cloud?.nonce ?? 'offline');
    lock(broadcast = true): void { this.sync.invalidateLogin(); const active = Boolean(this.session || this.cloud); this.contextStamp = randomId(); this.session = null; this.cloud = null; if (active) {
        this.onLocked();
        if (broadcast)
            this.channel?.postMessage({ kind: 'locked' });
    } this.infoChanged(); }
    client = (session: Session | null, onLocked: () => void): Native => {
        this.onLocked = onLocked;
        return async <T>(operation: string, payload: Record<string, unknown> = {}): Promise<T> => {
            const captured = structuredClone({ ...payload, ...(session ? { token: session.token } : {}) });
            try {
                return await this.run(operation, captured) as T;
            }
            catch (cause) {
                if (cause instanceof AccountingError) {
                    if (cause.code === 'SESSION_LOCKED' && (!this.session || this.session.token === captured['token']))
                        this.lock();
                    throw cause;
                }
                throw new AccountingError('BROWSER_OPERATION_FAILED', 'The browser operation failed. No successful save was acknowledged; inspect the persisted receipt before retrying.');
            }
        };
    };
    identity(token: string): LocalSession {
        ensure(this.session && this.session.token === token && performance.now() - this.session.touched < 900000, 'SESSION_LOCKED', 'Unlock this browser workspace again.');
        this.session.touched = performance.now();
        return { ...this.session };
    }
    async checked(tx: IDBTransaction, auth: LocalSession): Promise<Vault> {
        const vault = await get(tx, 'meta', 'vault');
        if (!vault || vault.generation !== auth.generation || vault.tenantId !== auth.tenantId) {
            if (this.session?.token === auth.token)
                this.lock();
            throw new AccountingError('SESSION_LOCKED', 'The workspace was restored or replaced in another tab. Unlock again.');
        }
        return vault;
    }
    async transaction<T>(token: string, tables: readonly Table[], mode: IDBTransactionMode, work: (tx: IDBTransaction, auth: LocalSession) => Promise<T> | T): Promise<T> {
        const auth = this.identity(token);
        return this.db.transaction([...new Set<Table>(['meta', ...tables])], mode, async (tx) => { await this.checked(tx, auth); return work(tx, auth); });
    }
    event(tx: IDBTransaction, tenant: string, company: string, action: string, detail: string): void { put(tx, 'events', { id: randomId(), tenant, company, at: new Date().toISOString(), action, detail }); }
    clock(): number { const wall = now(), elapsed = this.anchor.wall + Math.floor((performance.now() - this.anchor.monotonic) / 1000); ensure(wall + 300 >= elapsed, 'CLOCK_ROLLBACK', 'Correct the device clock and reconnect before posting.'); return Math.max(wall, elapsed); }
    async authority(profile: Profile, generation: string): Promise<Grant> {
        ensure(!profile.paused || !paused.includes(profile.paused), 'SYNC_REVIEW_REQUIRED', 'This synchronized company needs online authority or recovery review. Read and encrypted backup remain available.');
        ensure(profile.generation === generation, 'RESTORED_DEVICE', 'This restored browser must reconcile its device generation before posting.');
        return verifyGrant(profile.grant, profile, this.clock());
    }
    async source(tx: IDBTransaction, tenant: string, company: string): Promise<Source> {
        const row = await get(tx, 'books', [tenant, company]);
        ensure(row, 'BOOK_NOT_FOUND', 'Select an existing company.');
        const state = boundedState(row.state);
        ensure(state.config.company.tenantId === tenant && state.config.company.companyId === company && Number.isSafeInteger(row.revision) && row.revision > 0, 'INTEGRITY_ERROR', 'Stored company scope/revision differs from its key. Records were preserved.');
        const deliveries = await companyRows(tx, 'outbox', tenant, company);
        this.reconcileSource(state, deliveries, tenant, company);
        const profile = await get(tx, 'profiles', [tenant, company]);
        ensure(!profile || (profile.tenant === tenant && profile.company === company && canonical(profile.key) === canonical([tenant, company])), 'INTEGRITY_ERROR', 'Stored cloud registration differs from this company scope.');
        const enrolling = Boolean(await get(tx, 'enrollments', [tenant, company]));
        return { row, state, deliveries, profile, enrolling };
    }
    reconcileSource(state: BookState, deliveries: Delivery[], tenant: string, company: string): void {
        ensure(deliveries.length === state.receipts.length && new Set(deliveries.map(d => d.command)).size === deliveries.length, 'INTEGRITY_ERROR', 'Command outbox and immutable receipts do not reconcile. Preserve a backup for recovery review.');
        for (const [sequence, receipt] of state.receipts.entries()) {
            const row = deliveries.find(d => d.command === receipt.commandId);
            ensure(row && row.tenant === tenant && row.company === company && canonical(row.key) === canonical([tenant, company, row.command]) && row.payload === receipt.payload, 'INTEGRITY_ERROR', 'Stored command identity/payload differs from its receipt.');
            ensure(receipt.command ? row.wire !== null && canonical(parseCommand(JSON.parse(row.wire) as unknown)) === canonical(receipt.command) : row.wire === null, 'INTEGRITY_ERROR', 'Stored typed command differs from its immutable receipt.');
            ensure(['not-enrolled', 'pending', 'sending', 'accepted', 'rejected', 'conflict'].includes(row.state) && row.sequence === sequence, 'INTEGRITY_ERROR', 'Unsupported outbox state/sequence.');
        }
    }
    private async status(): Promise<unknown> { return this.db.transaction(['meta'], 'readonly', async (tx) => ({ initialized: Boolean(await get(tx, 'meta', 'vault')), schema: 2, mode: 'browser' })); }
    private async setup(password: string): Promise<Session> {
        const value = await credential(password);
        const vault: Vault = { id: 'vault', tenantId: randomId(), generation: randomId(), credential: value };
        await this.db.transaction(['meta'], 'readwrite', async (tx) => { ensure(!await get(tx, 'meta', 'vault'), 'ALREADY_INITIALIZED', 'This browser workspace already exists. Unlock it instead.'); put(tx, 'meta', vault); });
        this.session = { token: randomId(), tenantId: vault.tenantId, generation: vault.generation, actorId: 'local-owner', mode: 'local-only', touched: performance.now() };
        this.notify();
        return this.publicSession();
    }
    private publicSession(): Session { ensure(this.session, 'SESSION_LOCKED', 'Unlock this workspace.'); return { token: this.session.token, tenantId: this.session.tenantId, actorId: 'local-owner', mode: 'local-only' }; }
    private async unlock(password: string): Promise<Session> {
        ensure(!this.unlocking && performance.now() >= this.failedUntil, 'RATE_LIMIT', 'Wait briefly before retrying the workspace password.');
        this.unlocking = true;
        try {
            const vault = await this.db.transaction(['meta'], 'readonly', tx => get(tx, 'meta', 'vault'));
            ensure(vault, 'NOT_INITIALIZED', 'Set up this browser or restore a backup first.');
            await unlock(password, vault.credential);
            await this.db.transaction(['meta'], 'readonly', async (tx) => { ensure(canonical(await get(tx, 'meta', 'vault')) === canonical(vault), 'SESSION_CHANGED', 'The vault changed during unlock. Retry against the current workspace.'); });
            this.session = { token: randomId(), tenantId: vault.tenantId, generation: vault.generation, actorId: 'local-owner', mode: 'local-only', touched: performance.now() };
            return this.publicSession();
        }
        catch (cause) {
            this.failedUntil = performance.now() + 2000;
            throw cause;
        }
        finally {
            this.unlocking = false;
        }
    }
    private async commit(token: string, company: string, revision: number, encoded: string, resolution?: {
        mode: string;
        original: string;
    }): Promise<unknown> {
        const auth = this.identity(token);
        const before = await this.transaction(token, ['books', 'outbox', 'profiles', 'enrollments'], 'readonly', (tx, a) => this.source(tx, a.tenantId, company));
        ensure(revision === before.row.revision, 'VERSION_CONFLICT', 'Another tab changed this company. Refresh and retry.');
        const after = boundedState(encoded);
        if (canonical(before.state) === canonical(after))
            return null;
        validateCommit(before.state, after);
        const principal: Principal = { tenantId: auth.tenantId, companyId: company, actorId: 'local-owner', permissions: LOCAL_PERMISSIONS };
        await replayCommit(before.state, after, principal);
        const receipt = after.receipts.at(-1)!;
        const command = receipt.command!;
        const financial = ['post', 'post-draft', 'reverse', 'save-draft'].includes(command.kind);
        if (before.enrolling && !financial)
            throw new AccountingError('ENROLLMENT_PENDING', 'Shared master edits wait until the original enrollment is reconciled or cancelled.');
        let claims: Grant | null = null;
        if (before.profile) {
            ensure(financial, 'ONLINE_MASTER_REQUIRED', 'Connect to edit shared chart, calendar or period locks.');
            claims = await this.authority(before.profile, auth.generation);
            const permission = command.kind === 'reverse' ? 'reverse' : command.kind === 'save-draft' ? 'draft' : 'post';
            ensure(claims.permissions.includes(permission), 'FORBIDDEN', 'Current offline permissions do not authorize this action.');
        }
        await this.transaction(token, TABLES, 'readwrite', async (tx, a) => {
            const current = await this.source(tx, a.tenantId, company);
            ensure(current.row.revision === revision, 'VERSION_CONFLICT', 'Another tab changed this company. Refresh and retry.');
            ensure(Boolean(current.profile) === Boolean(before.profile) && current.profile?.version === before.profile?.version, 'VERSION_CONFLICT', 'Offline authority changed during validation. Retry with the current permission grant.');
            if (current.enrolling && !financial)
                throw new AccountingError('ENROLLMENT_PENDING', 'The reviewed enrollment snapshot freezes shared master edits.');
            if (current.profile) {
                ensure(claims && this.clock() < claims.expiresAt && (!current.profile.paused || !paused.includes(current.profile.paused)), 'OFFLINE_GRANT_EXPIRED', 'Offline authority expired or changed before commit. Reconnect before posting.');
            }
            ensure(Number.isSafeInteger(revision + 1), 'DATA_LIMIT', 'Company revision reached the supported limit.');
            const delivery: Delivery = { key: [a.tenantId, company, receipt.commandId], tenant: a.tenantId, company, command: receipt.commandId, payload: receipt.payload, wire: encode(command), state: current.profile ? 'pending' : 'not-enrolled', sequence: current.state.receipts.length,
                attempts: 0, nextAttempt: 0, leaseUntil: 0, leaseOwner: null, lastError: null, serverCursor: null, root: null, localOnly: false };
            if (resolution)
                await this.resolution(tx, current, after, delivery, resolution);
            put(tx, 'books', { ...current.row, revision: revision + 1, state: encode(after) });
            put(tx, 'outbox', delivery);
            if (current.profile)
                put(tx, 'profiles', { ...current.profile, lastSeen: Math.max(current.profile.lastSeen, this.clock()) });
        });
        this.notify();
        return null;
    }
    private async resolution(tx: IDBTransaction, source: Source, after: BookState, delivery: Delivery, request: {
        mode: string;
        original: string;
    }): Promise<void> {
        const old = source.deliveries.find(d => d.command === request.original);
        ensure(old && ['rejected', 'conflict'].includes(old.state) && source.profile, 'INVALID_RESOLUTION', 'Only a durable cloud rejection/conflict can be resolved. Unknown outcomes must be retried.');
        const root = old.root ?? old.command;
        const receipt = after.receipts.at(-1)!;
        const scope = after.config.company;
        const canonicalBook = boundedState(source.profile.canonical);
        if (request.mode === 'compensate') {
            const prior = source.state.receipts.find(r => r.commandId === old.command)?.result;
            ensure(journalResult(prior) && journalResult(receipt.result), 'INVALID_RESOLUTION', 'Compensation requires a rejected source journal.');
            const result = receipt.result;
            const linked = receipt.command?.kind === 'reverse' && result.reverses === prior.id;
            const contra = prior.reverses !== null && receipt.command?.kind === 'post' && result.reverses === null && result.intent === 'general' && result.date >= prior.date && result.narration.trim().length > 0 &&
                prior.lines.length === result.lines.length && prior.lines.every((line, i) => { const next = result.lines[i]; return next && next.ledgerId === line.ledgerId && next.amount === line.amount && next.side !== line.side; });
            ensure((linked || contra) && !canonicalBook.entries.some(e => e.id === prior.id), 'INVALID_RESOLUTION', 'Device compensation must exactly offset a rejected local journal absent from accepted history.');
            ensure(!await get(tx, 'resolutions', [scope.tenantId, scope.companyId, old.command]), 'ALREADY_COMPENSATED', 'This source command already has a device compensation. Resume its replacement instead.');
            delivery.localOnly = true;
            delivery.state = 'not-enrolled';
            put(tx, 'resolutions', { key: [scope.tenantId, scope.companyId, old.command], tenant: scope.tenantId, company: scope.companyId, root, originalCommand: old.command, compensation: delivery.command, replacement: null, reason: result.narration });
        }
        else if (request.mode === 'replace') {
            const ready = await get(tx, 'resolutions', [scope.tenantId, scope.companyId, old.command]);
            ensure(ready && receipt.command?.kind === 'post', 'INVALID_RESOLUTION', 'Compensate the rejected source journal before its replacement.');
            ensure(!source.deliveries.some(d => d.root === root && d.state === 'accepted'), 'ALREADY_RESOLVED', 'This root already has an accepted replacement.');
            delivery.root = root;
            put(tx, 'resolutions', { ...ready, replacement: delivery.command });
        }
        else
            throw new AccountingError('INVALID_RESOLUTION', 'Unsupported resolution action.');
        this.event(tx, scope.tenantId, scope.companyId, 'exception-resolution', request.mode + ' ' + old.command + ' with ' + delivery.command);
    }
    private async run(operation: string, p: Record<string, unknown>): Promise<unknown> {
        if (operation === 'status')
            return this.status();
        if (operation === 'setup')
            return this.setup(String(p['password'] ?? ''));
        if (operation === 'unlock')
            return this.unlock(String(p['password'] ?? ''));
        if (operation === 'lock') {
            this.lock();
            return null;
        }
        const token = String(p['token'] ?? '');
        this.identity(token);
        const company = typeof p['companyId'] === 'string' && p['companyId'].length > 0 ? identifier(p['companyId'], 'companyId') : '';
        if (operation.startsWith('cloud_'))
            return this.sync.run(operation, token, company, p);
        if (operation === 'list_books')
            return this.transaction(token, ['books'], 'readonly', async (tx, a) => (await all(tx, 'books')).filter(b => b.tenant === a.tenantId).map(b => ({ companyId: b.company, name: boundedState(b.state).config.company.name })));
        if (operation === 'read_book')
            return this.transaction(token, ['books', 'outbox', 'profiles', 'enrollments'], 'readonly', async (tx, a) => { const source = await this.source(tx, a.tenantId, company); return { revision: source.row.revision, state: source.row.state }; });
        if (operation === 'create_book') {
            const state = boundedState(String(p['state'] ?? ''));
            const auth = this.identity(token);
            const scope = state.config.company;
            ensure(scope.tenantId === auth.tenantId, 'SCOPE_MISMATCH', 'Company belongs to another browser vault.');
            defineBook(state.config);
            ensure(state.chartVersion === 1 && [state.entries, state.receipts, state.audit, state.drafts].every(rows => rows.length === 0), 'INVALID_INITIAL_STATE', 'Create an empty company; post opening balances through journals.');
            await this.transaction(token, ['books', 'profiles'], 'readwrite', async (tx, a) => { ensure(!await get(tx, 'books', [a.tenantId, scope.companyId]) && !await get(tx, 'profiles', [a.tenantId, scope.companyId]), 'BOOK_EXISTS', 'Company already exists.'); put(tx, 'books', { key: [a.tenantId, scope.companyId], tenant: a.tenantId, company: scope.companyId, revision: 1, state: encode(state) }); });
            this.notify();
            return null;
        }
        if (operation === 'commit_book' || operation === 'commit_resolution')
            return this.commit(token, company, Number(p['revision']), String(p['state'] ?? ''), operation === 'commit_resolution' ? { mode: String(p['resolutionMode'] ?? ''), original: String(p['originalCommand'] ?? '') } : undefined);
        if (operation === 'backup') {
            const bytes = await this.exportBackup(token, String(p['passphrase'] ?? ''));
            const link = document.createElement('a');
            const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
            link.href = url;
            link.download = 'accounting-' + new Date().toISOString().slice(0, 10) + '.erpwebbackup';
            document.body.append(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 60000);
            return { completed: true };
        }
        if (operation === 'restore') {
            ensure(p['confirmed'] === true, 'CONFIRM_RESTORE', 'Confirm replacement after preserving a current backup.');
            const file = await this.chooseBackup();
            if (!file)
                return { completed: false };
            ensure(file.size <= BACKUP_LIMIT, 'INVALID_BACKUP', 'Backup exceeds the 128 MiB browser limit.');
            await this.restoreBackup(token, String(p['passphrase'] ?? ''), new Uint8Array(await file.arrayBuffer()));
            return { completed: true };
        }
        throw new AccountingError('UNSUPPORTED_OPERATION', 'Unsupported browser workspace operation.');
    }
    private chooseBackup(): Promise<File | null> {
        return new Promise(resolve => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.erpwebbackup';
            input.style.display = 'none';
            document.body.append(input);
            const done = (file: File | null) => { input.remove(); resolve(file); };
            input.addEventListener('change', () => done(input.files?.[0] ?? null), { once: true });
            input.addEventListener('cancel', () => done(null), { once: true });
            input.click();
        });
    }
    async exportBackup(token: string, passphrase: string): Promise<Uint8Array<ArrayBuffer>> {
        const tables = await this.transaction(token, TABLES, 'readonly', async (tx) => {
            const output: Backup['tables'] = {meta: [], books: [], outbox: [], profiles: [], intents: [], enrollments: [], joins: [], resolutions: [], events: []};
            let bytes = new TextEncoder().encode(encode({ format: 'ERPWEB01', schema: 2, tables: output })).length;
            for (const table of TABLES)
                await new Promise<void>((resolve, reject) => {
                    const request = tx.objectStore(table).openCursor();
                    request.onerror = () => reject(request.error);
                    request.onsuccess = () => {
                        const cursor = request.result;
                        if (!cursor) {
                            resolve();
                            return;
                        }
                        try {
                            const rows = output[table] as unknown[];
                            bytes += new TextEncoder().encode(encode(cursor.value)).length + (rows.length ? 1 : 0);
                            ensure(bytes + 56 <= BACKUP_LIMIT, 'BACKUP_TOO_LARGE', 'This vault exceeds the 128 MiB browser backup limit. Preserve storage and request a reviewed export strategy.');
                            rows.push(cursor.value);
                            cursor.continue();
                        }
                        catch (cause) {
                            reject(cause);
                        }
                    };
                });
            return output;
        });
        return encryptBackup(passphrase, encode({ format: 'ERPWEB01', schema: 2, tables } satisfies Backup));
    }
    async restoreBackup(token: string, passphrase: string, bytes: Uint8Array<ArrayBuffer>): Promise<void> {
        this.identity(token);
        const decoded = await decryptBackup(passphrase, bytes);
        let candidate: Backup;
        try {
            candidate = JSON.parse(decoded) as Backup;
            ensure(candidate.format === 'ERPWEB01' && candidate.schema === 2 && candidate.tables && Object.keys(candidate.tables).sort().join(',') === [...TABLES].sort().join(','), 'INVALID_BACKUP', 'Unsupported browser backup schema/tables.');
            for (const table of TABLES)
                ensure(Array.isArray(candidate.tables[table]) && candidate.tables[table].length <= 100000, 'INVALID_BACKUP', 'Unsupported backup row structure/count.');
            validateTables(candidate.tables);
            ensure(candidate.tables.meta.length === 1, 'INVALID_BACKUP', 'Backup needs exactly one browser vault.');
            const vault = candidate.tables.meta[0]!;
            ensure(vault.id === 'vault' && vault.credential && typeof vault.credential.salt === 'string' && typeof vault.credential.iv === 'string' && typeof vault.credential.cipher === 'string', 'INVALID_BACKUP', 'Backup credential metadata is missing.');
            identifier(vault.tenantId, 'tenantId');
            identifier(vault.generation, 'generation');
            const keys = new Set<string>();
            for (const row of candidate.tables.books) {
                const scope = [vault.tenantId, row.company];
                ensure(row.tenant === vault.tenantId && canonical(row.key) === canonical(scope) && !keys.has(row.company) && Number.isSafeInteger(row.revision) && row.revision > 0, 'INVALID_BACKUP', 'Backup company keys/revisions must be unique and scoped.');
                keys.add(row.company);
                const state = boundedState(row.state);
                ensure(state.config.company.tenantId === vault.tenantId && state.config.company.companyId === row.company, 'INVALID_BACKUP', 'Backup book scope differs from its key.');
                this.reconcileSource(state, candidate.tables.outbox.filter(d => d.tenant === row.tenant && d.company === row.company), row.tenant, row.company);
            }
            for (const table of ['outbox', 'profiles', 'intents', 'enrollments', 'resolutions', 'events'] as const)
                for (const row of candidate.tables[table])
                    ensure(row.tenant === vault.tenantId && keys.has(row.company), 'INVALID_BACKUP', 'Backup contains an orphaned/foreign company record.');
            for (const row of candidate.tables.joins)
                ensure(row.tenant === vault.tenantId, 'INVALID_BACKUP', 'Backup join intent belongs to another vault.');
            for (const profile of candidate.tables.profiles) {
                const canonicalBook = boundedState(profile.canonical);
                ensure(canonicalBook.config.company.tenantId === profile.remoteTenant && canonicalBook.config.company.companyId === profile.remoteCompany && canonical(profile.key) === canonical([profile.tenant, profile.company]), 'INVALID_BACKUP', 'Backup canonical company scope differs from its registration.');
            }
            for (const book of candidate.tables.books) {
                const profile = candidate.tables.profiles.find(p => p.company === book.company);
                ensure(!profile || !candidate.tables.enrollments.some(e => e.company === book.company), 'INVALID_BACKUP', 'A company cannot be enrolled and pending enrollment together.');
                for (const row of candidate.tables.outbox.filter(d => d.company === book.company))
                    ensure(profile || row.state === 'not-enrolled', 'INVALID_BACKUP', 'Cloud delivery states require a cloud registration.');
                for (const intent of candidate.tables.intents.filter(i => i.company === book.company))
                    ensure(profile && intent.command.length > 0, 'INVALID_BACKUP', 'A shared master intent requires its registered company.');
                const deliveries = candidate.tables.outbox.filter(d => d.company === book.company);
                for (const resolution of candidate.tables.resolutions.filter(r => r.company === book.company))
                    ensure(profile && deliveries.some(d => d.command === resolution.originalCommand && ['rejected', 'conflict'].includes(d.state)) && deliveries.some(d => d.command === resolution.compensation && d.localOnly) && (!resolution.replacement || deliveries.some(d => d.command === resolution.replacement && d.root === resolution.root)), 'INVALID_BACKUP', 'Resolution links must reconcile to their retained command evidence.');
                for (const row of deliveries.filter(d => d.localOnly))
                    ensure(candidate.tables.resolutions.some(r => r.company === book.company && r.compensation === row.command), 'INVALID_BACKUP', 'Device-only compensation requires its resolution evidence.');
            }
        }
        catch (cause) {
            if (cause instanceof AccountingError)
                throw cause;
            throw new AccountingError('INVALID_BACKUP', 'Backup structure is invalid. Current browser records were preserved.');
        }
        const vault = candidate.tables.meta[0]!;
        vault.generation = randomId();
        for (const profile of candidate.tables.profiles) {
            profile.paused = 'restored';
            profile.leaseOwner = null;
            profile.leaseUntil = 0;
            profile.version++;
        }
        for (const delivery of candidate.tables.outbox) {
            if (delivery.state === 'sending')
                delivery.state = 'pending';
            delivery.leaseOwner = null;
            delivery.leaseUntil = 0;
        }
        await this.transaction(token, TABLES, 'readwrite', tx => {
            for (const table of TABLES)
                tx.objectStore(table).clear();
            for (const table of TABLES)
                for (const row of candidate.tables[table])
                    tx.objectStore(table).put(row);
        });
        this.lock();
        this.notify();
    }
}
