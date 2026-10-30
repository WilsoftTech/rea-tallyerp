import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';
import type { Prisma } from './generated/prisma/client.js';
import { AccountingError } from '@erp/domain';

export type Tx = Prisma.TransactionClient;
/** SQL is a source-controlled statement; every variable remains a driver parameter. */
export function query<T>(tx: Tx, sql: string, ...parameters: unknown[]): Promise<T[]> {
  return tx.$queryRawUnsafe<T[]>(sql, ...parameters);
}
export function execute(tx: Tx, sql: string, ...parameters: unknown[]): Promise<number> {
  return tx.$executeRawUnsafe(sql, ...parameters);
}
export function database(connectionString: string): PrismaClient {
  const url = new URL(connectionString);
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  const adapter = new PrismaPg({ connectionString, max: 6, connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 10000, ssl: local ? false : { rejectUnauthorized: true } });
  return new PrismaClient({ adapter, transactionOptions: { maxWait: 5000, timeout: 20000 } });
}
export async function context(tx: Tx, userId: string, tenantId: string): Promise<void> {
  await query(tx, "SELECT set_config('app.user',$1,true),set_config('app.tenant',$2,true)", userId, tenantId);
}
export function safeCounter(value: bigint | number): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) throw new AccountingError('CURSOR_OVERFLOW', 'Counter exceeds the supported protocol range.');
  return result;
}
export async function assertRuntime(client: PrismaClient): Promise<void> {
  const rows = await client.$queryRawUnsafe<{ rolsuper: boolean; rolbypassrls: boolean; owns: boolean }[]>(
    "SELECT r.rolsuper,r.rolbypassrls,EXISTS(SELECT 1 FROM pg_tables WHERE schemaname='public' AND tableowner=current_user) AS owns FROM pg_roles r WHERE r.rolname=current_user");
  if (!rows[0] || rows[0].rolsuper || rows[0].rolbypassrls || rows[0].owns)
    throw new AccountingError('UNSAFE_DATABASE_ROLE', 'API runtime must not own tables or bypass row security.');
}
