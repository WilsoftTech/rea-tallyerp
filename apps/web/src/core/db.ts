import { AccountingError } from '@erp/domain';
import type { Records, Table } from './records.js';
export const DATABASE = 'erp-browser-workspace';
export const SCHEMA = 2;
export function storageError(cause: unknown): Error {
    if (cause instanceof AccountingError)
        return cause;
    const name = cause instanceof DOMException ? cause.name : '';
    if (name === 'QuotaExceededError')
        return new AccountingError('STORAGE_QUOTA', 'Browser storage is full. No successful save was acknowledged. Export a backup and free space before retrying.');
    if (name === 'VersionError')
        return new AccountingError('SCHEMA_TOO_NEW', 'This workspace was upgraded by another version. Close all workspace tabs and reopen the current application; existing records were preserved.');
    return new AccountingError('STORAGE_UNAVAILABLE', 'Browser storage could not complete the operation. Records were not reset. Check browser storage permissions and retry.');
}
export function request<T>(value: IDBRequest<T>): Promise<T> { return new Promise((resolve, reject) => { value.onsuccess = () => resolve(value.result); value.onerror = () => reject(value.error); }); }
export function get<K extends Table>(tx: IDBTransaction, table: K, key: IDBValidKey): Promise<Records[K] | undefined> {
    return request(tx.objectStore(table).get(key)) as Promise<Records[K] | undefined>;
}
export function all<K extends Table>(tx: IDBTransaction, table: K): Promise<Records[K][]> { return request(tx.objectStore(table).getAll()) as Promise<Records[K][]>; }
export function companyRows<K extends 'outbox' | 'intents' | 'resolutions'>(tx: IDBTransaction, table: K, tenant: string, company: string): Promise<Records[K][]> {
    return request(tx.objectStore(table).index('company').getAll([tenant, company])) as Promise<Records[K][]>;
}
export function put<K extends Table>(tx: IDBTransaction, table: K, row: Records[K]): void { tx.objectStore(table).put(row); }
export class Database {
    private database: IDBDatabase | null = null;
    private opening: Promise<IDBDatabase> | null = null;
    private closed = false;
    stale = false;
    blocked = false;
    durability: 'strict' | 'default' = 'default';
    constructor(readonly name = DATABASE, readonly changed: () => void = () => { }) { }
    close(): void { this.closed = true; this.database?.close(); this.database = null; }
    private open(): Promise<IDBDatabase> {
        if (this.closed || this.stale)
            return Promise.reject(new AccountingError('STORAGE_RELOAD_REQUIRED', 'Close other workspace tabs and reload to use the current database version. Records were preserved.'));
        if (this.database)
            return Promise.resolve(this.database);
        if (this.opening)
            return this.opening;
        if (!globalThis.indexedDB)
            return Promise.reject(new AccountingError('UNSUPPORTED_BROWSER', 'This browser does not provide IndexedDB. Use a supported browser or the Windows application.'));
        this.opening = new Promise<IDBDatabase>((resolve, reject) => {
            let ended = false;
            const opening = indexedDB.open(this.name, SCHEMA);
            const timer = setTimeout(() => { if (!ended) {
                ended = true;
                reject(new AccountingError('STORAGE_BLOCKED', 'Another tab is blocking a storage upgrade. Close all other workspace tabs, then reload. Existing records are preserved.'));
            } }, 5000);
            opening.onblocked = () => { this.blocked = true; this.changed(); };
            opening.onupgradeneeded = (event) => {
                if (ended) {
                    opening.transaction?.abort();
                    return;
                }
                const db = opening.result;
                const tx = opening.transaction!;
                if (event.oldVersion < 1) {
                    db.createObjectStore('meta', { keyPath: 'id' });
                    for (const table of ['books', 'outbox', 'profiles', 'intents', 'enrollments', 'joins', 'resolutions'])
                        db.createObjectStore(table, { keyPath: 'key' });
                    tx.objectStore('books').createIndex('tenant', 'tenant');
                    tx.objectStore('profiles').createIndex('tenant', 'tenant');
                }
                if (event.oldVersion < 2) {
                    db.createObjectStore('events', { keyPath: 'id' });
                    for (const table of ['outbox', 'intents', 'resolutions'])
                        tx.objectStore(table).createIndex('company', ['tenant', 'company']);
                }
            };
            opening.onerror = () => { clearTimeout(timer); if (!ended) {
                ended = true;
                reject(storageError(opening.error));
            } };
            opening.onsuccess = () => {
                clearTimeout(timer);
                const db = opening.result;
                if (ended || this.closed) {
                    db.close();
                    if (!ended) {
                        ended = true;
                        reject(new AccountingError('STORAGE_RELOAD_REQUIRED', 'This workspace was closed while storage opened. Reload before continuing.'));
                    }
                    return;
                }
                ended = true;
                this.database = db;
                this.blocked = false;
                db.onversionchange = () => { this.stale = true; db.close(); this.database = null; this.changed(); };
                db.onclose = () => { this.database = null; this.changed(); };
                resolve(db);
                this.changed();
            };
        }).finally(() => { this.opening = null; });
        return this.opening;
    }
    /** Work may await IDB requests only; crypto/network must finish before opening a write transaction. */
    async transaction<T>(tables: readonly Table[], mode: IDBTransactionMode, work: (tx: IDBTransaction) => Promise<T> | T): Promise<T> {
        const db = await this.open();
        let tx: IDBTransaction;
        try {
            tx = db.transaction([...tables], mode, mode === 'readwrite' ? { durability: 'strict' } : undefined);
        }
        catch (cause) {
            if (cause instanceof TypeError) {
                tx = db.transaction([...tables], mode);
            }
            else
                throw storageError(cause);
        }
        if (mode === 'readwrite')
            this.durability = tx.durability === 'strict' ? 'strict' : 'default';
        return new Promise<T>((resolve, reject) => {
            let value: T;
            let finished = false;
            let failure: unknown;
            tx.oncomplete = () => finished ? resolve(value) : reject(new AccountingError('ASYNC_TRANSACTION', 'Storage work outlived its transaction. Inspect the persisted receipt before retrying.'));
            tx.onabort = () => reject(storageError(failure ?? tx.error));
            tx.onerror = () => { };
            try {
                Promise.resolve(work(tx)).then(result => { value = result; finished = true; }).catch(cause => { failure = cause; try {
                    tx.abort();
                }
                catch { /* already ended */ } reject(storageError(cause)); });
            }
            catch (cause) {
                failure = cause;
                try {
                    tx.abort();
                }
                catch { /* already ended */ }
                reject(storageError(cause));
            }
        });
    }
}
