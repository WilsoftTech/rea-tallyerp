import { AccountingError, defineBook, freeze, sameScope } from '@erp/domain';
import type { Scope } from '@erp/domain';
import { validateCommit } from '@erp/application';
import type { BookState, BookStore } from '@erp/application';
import { encode, json, parseBook } from '@erp/contracts';
import { execute, query } from './db.js';
import type { Tx } from './db.js';

/** Runs the shared application against one already row-locked server snapshot. */
export class TransactionBookStore implements BookStore {
  constructor(public current: BookState) {}
  async transact<T>(scope: Scope, work: (book: BookState) => T): Promise<T> {
    sameScope(this.current.config.company, scope);
    const working = structuredClone(this.current); const result = work(working);
    if (result instanceof Promise) throw new AccountingError('ASYNC_TRANSACTION', 'Transaction work must be synchronous.');
    validateCommit(this.current, working); this.current = working;
    return freeze(structuredClone(result));
  }
  async read(scope: Scope): Promise<BookState> { sameScope(this.current.config.company, scope); return structuredClone(this.current); }
}
export interface LockedBook { state: BookState; revision: bigint; cursor: bigint; epoch: string }
export async function lockBook(tx: Tx, scope: Scope): Promise<LockedBook> {
  const rows = await query<{ state: string; revision: bigint; cursor: bigint; epoch: string }>(tx,
    'SELECT state,revision,cursor,epoch FROM cloud_books WHERE tenant_id=$1 AND company_id=$2 FOR UPDATE', scope.tenantId, scope.companyId);
  const row = rows[0]; if (!row) throw new AccountingError('BOOK_NOT_FOUND', 'Cloud company was not found.');
  return { ...row, state: parseBook(JSON.parse(row.state) as unknown) };
}
/** SQL constraints complement shared validation; called only inside the outcome/change transaction. */
export async function project(tx: Tx, before: BookState | null, after: BookState): Promise<void> {
  after.config = defineBook(after.config);
  if (before) validateCommit(before, after);
  const { tenantId: t, companyId: c } = after.config.company;
  for (const p of after.config.periods) await execute(tx,
    'INSERT INTO cloud_periods VALUES($1,$2,$3,$4,$5::date,$6::date,$7,$8) ON CONFLICT(tenant_id,company_id,id) DO UPDATE SET year_id=excluded.year_id,start_date=excluded.start_date,end_date=excluded.end_date,status=excluded.status,version=excluded.version',
    t, c, p.id, p.yearId, p.start, p.end, p.status, BigInt(p.version));
  for (const l of after.config.ledgers) await execute(tx, 'INSERT INTO cloud_ledgers VALUES($1,$2,$3) ON CONFLICT DO NOTHING', t, c, l.id);
  for (const entry of after.entries.filter((e) => !before?.entries.some((p) => p.id === e.id))) {
    await execute(tx, 'INSERT INTO cloud_journals(tenant_id,company_id,id,period_id,business_date,period_version,body) VALUES($1,$2,$3,$4,$5::date,$6,$7::jsonb)',
      t, c, entry.id, entry.periodId, entry.date, BigInt(entry.periodVersion), encode(json(entry)));
    for (const [i, l] of entry.lines.entries()) await execute(tx, 'INSERT INTO cloud_lines VALUES($1,$2,$3,$4,$5,$6,$7)', t, c, entry.id, i, l.ledgerId, l.side, l.amount);
    await execute(tx, 'UPDATE cloud_journals SET finalized=true WHERE tenant_id=$1 AND company_id=$2 AND id=$3', t, c, entry.id);
  }
  for (let i = before?.audit.length ?? 0; i < after.audit.length; i++) await execute(tx,
    'INSERT INTO cloud_audit VALUES($1,$2,$3,$4::jsonb)', t, c, BigInt(i), encode(after.audit[i]));
  for (const [key, table] of [['periods', 'cloud_periods'], ['ledgers', 'cloud_ledgers']] as const) {
    for (const prior of before?.config[key] ?? []) if (!after.config[key].some((row) => row.id === prior.id))
      await execute(tx, 'DELETE FROM ' + table + ' WHERE tenant_id=$1 AND company_id=$2 AND id=$3', t, c, prior.id);
  }
}
