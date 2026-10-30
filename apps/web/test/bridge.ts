import { BrowserRuntime } from '../src/core/runtime.js';
import { Database, all } from '../src/core/db.js';
import { TABLES } from '../src/core/records.js';
import type { Records, Table } from '../src/core/records.js';
import { encryptBackup, decryptBackup } from '../src/core/crypto.js';
import { ClientBookStore } from '@erp/workspace/store';
import { LOCAL_PERMISSIONS } from '@erp/workspace/host';
import type { Session } from '@erp/workspace/host';
import { AccountingService, canonical } from '@erp/application';
import type { FinancialCommand, Principal } from '@erp/application';
import { configuration, journal } from '../../../packages/domain/test/fixtures.js';
import { trialBalance, AccountingError } from '@erp/domain';
import { remap, encode } from '@erp/contracts/codec';
let core: BrowserRuntime;
let session: Session | null = null;
let company = 'company-a';
const call = <T>(op: string, p: Record<string, unknown> = {}) => core.client(session, () => { session = null; })<T>(op, p);
const scope = () => { if (!session)
    throw new AccountingError('SESSION_LOCKED', 'Unlock this browser workspace again.'); return { tenantId: session.tenantId, companyId: company }; };
const principal = (): Principal => ({ ...scope(), actorId: 'local-owner', permissions: LOCAL_PERMISSIONS });
const store = () => new ClientBookStore(call);
const service = () => new AccountingService(store(), () => '2026-01-15T12:00:00.000Z');
const bridge = {
    init(name: string) { core?.close(); core = new BrowserRuntime(location.origin, name); session = null; },
    async setup() { session = await call<Session>('setup', { password: 'Synthetic browser password 2026' }); return { tenantId: session.tenantId }; },
    async unlock() { session = await call<Session>('unlock', { password: 'Synthetic browser password 2026' }); return { tenantId: session.tenantId }; },
    async register(id = 'company-a') { company = id; await store().register(remap(configuration(), configuration().company, { tenantId: session!.tenantId, companyId: company })); },
    select(id: string) { company = id; },
    async post(id: string, amount = '1000', side = 'cash') { return service().post(principal(), { kind: 'post', commandId: id, expectedChartVersion: (await store().read(principal())).chartVersion, journal: journal({ ...scope(), id: 'journal-' + id, lines: [{ ledgerId: side, side: 'debit', amount: BigInt(amount) }, { ledgerId: 'equity', side: 'credit', amount: BigInt(amount) }] }) }).then(r => ({ id: r.id })); },
    async compensate(id: string, original: string) { const resolved = new AccountingService(new ClientBookStore(call, { resolutionMode: 'compensate', originalCommand: original }), () => '2026-02-15T12:00:00.000Z'); const { lines, intent, ...input } = journal({ ...scope(), id: 'journal-' + id }); void lines; void intent; await resolved.reverse(principal(), { kind: 'reverse', commandId: id, expectedChartVersion: (await store().read(principal())).chartVersion, originalId: 'journal-' + original, journal: { ...input, date: '2026-02-15', periodId: 'feb', expectedPeriodVersion: 1 } }); },
    async reverse(id: string, original: string) { const { lines, intent, ...input } = journal({ ...scope(), id: 'journal-' + id }); void lines; void intent; await service().reverse(principal(), { kind: 'reverse', commandId: id, expectedChartVersion: (await store().read(principal())).chartVersion, originalId: 'journal-' + original, journal: { ...input, date: '2026-02-15', periodId: 'feb', expectedPeriodVersion: 1 } }); },
    async command(raw: string) { const command = JSON.parse(raw) as FinancialCommand; if (command.kind !== 'period-status')
        throw Error('Only the test period command is supported here.'); return service().setPeriodStatus(principal(), command); },
    async summary() { const book = await store().read(principal()); const tb = trialBalance(book.config, book.entries, '2026-12-31'); return { entries: book.entries.length, receipts: book.receipts.length, audit: book.audit.length, debit: tb.debit.toString(), credit: tb.credit.toString(), state: encode(book) }; },
    async raw() { return core.db.transaction(TABLES, 'readonly', async (tx) => Object.fromEntries(await Promise.all(TABLES.map(async (t) => [t, await all(tx, t)]))) as {
        [K in Table]: Records[K][];
    }); },
    async invoke(op: string, p: Record<string, unknown> = {}) { return call(op, { companyId: company, ...p }); },
    async backup() { return Array.from(await core.exportBackup(session!.token, 'Synthetic backup phrase 2026')); },
    async restore(bytes: number[], password = 'Synthetic backup phrase 2026') { await core.restoreBackup(session!.token, password, new Uint8Array(bytes)); session = null; },
    async malformedBackup(bytes: number[], mode: string) { const value = JSON.parse(await decryptBackup('Synthetic backup phrase 2026', new Uint8Array(bytes))) as {
        tables: Record<string, Record<string, unknown>[]>;
    }; if (mode === 'duplicate')
        value.tables['books']!.push(value.tables['books']![0]!); if (mode === 'metadata')
        value.tables['outbox']![0]!['attempts'] = -1; return Array.from(await encryptBackup('Synthetic backup phrase 2026', JSON.stringify(value))); },
    async abort() { return core.transaction(session!.token, ['books', 'outbox'], 'readwrite', async (tx) => { tx.objectStore('books').clear(); tx.objectStore('outbox').clear(); throw new AccountingError('INJECTED_ABORT', 'Synthetic abort.'); }); },
    async quota() { const bytes = new Uint8Array(16 * 1024 * 1024); for (let i = 0; i < bytes.length; i += 65536)
        crypto.getRandomValues(bytes.subarray(i, i + 65536)); return core.transaction(session!.token, ['books', 'events'], 'readwrite', tx => { tx.objectStore('books').clear(); tx.objectStore('events').put({ id: 'quota-injection', tenant: session!.tenantId, company, at: '2026-01-15T12:00:00.000Z', action: 'synthetic-quota', detail: bytes }); }); },
    crashWrite() { void core.transaction(session!.token, ['books', 'outbox'], 'readwrite', tx => { tx.objectStore('books').clear(); tx.objectStore('outbox').clear(); return new Promise(() => { const keepAlive = () => { const request = tx.objectStore('books').get('crash-marker'); request.onsuccess = keepAlive; }; keepAlive(); (window as unknown as {
        crashReady: boolean;
    }).crashReady = true; }); }).catch(() => { }); },
    async tamper() { const current = await call<{
        revision: number;
        state: string;
    }>('read_book', { companyId: company }); const state = JSON.parse(current.state) as {
        entries: {
            lines: {
                amount: string;
            }[];
        }[];
    }; state.entries[0]!.lines[0]!.amount = '333'; await call('commit_book', { companyId: company, revision: current.revision, state: JSON.stringify(state) }); },
    close() { core.close(); session = null; },
    info() { return { schema: 2, stale: core.db.stale, blocked: core.db.blocked, durability: core.db.durability, session: Boolean(session) }; },
    async dbProbe(name: string) { const db = new Database(name); try {
        return await db.transaction(['meta'], 'readonly', tx => all(tx, 'meta'));
    }
    finally {
        db.close();
    } },
    canonical,
};
declare global {
    interface Window {
        lab: typeof bridge;
    }
}
window.lab = bridge;
