import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { AccountingError, ensure } from '@erp/domain';
import { ROLE_PERMISSIONS } from '@erp/contracts';
import type { Role } from '@erp/contracts';
import type { PrismaClient } from './generated/prisma/client.js';
import { context, execute, query } from './db.js';
import type { Tx } from './db.js';

export interface Actor { userId: string; username: string }
export interface Member { tenantId: string; userId: string; role: Role; version: number }
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
let passwordWork = 0;
async function derive(password: string, salt: string): Promise<Buffer> {
  ensure(passwordWork < 4, 'RATE_LIMIT', 'Password service is busy. Retry shortly.');
  passwordWork++;
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
        (error, key) => error ? reject(error) : resolve(key));
    });
  } finally { passwordWork--; }
}
export async function hashPassword(password: string): Promise<string> {
  ensure(password.length >= 12 && password.length <= 1024, 'INVALID_PASSWORD', 'Use a password of 12–1024 characters.');
  const salt = randomBytes(16).toString('hex');
  return 'scrypt-v1:' + salt + ':' + (await derive(password, salt)).toString('hex');
}
async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, salt, hash] = encoded.split(':');
  const key = await derive(password, salt ?? 'unregistered-account-salt');
  const expected = algorithm === 'scrypt-v1' && hash && /^[a-f0-9]{128}$/.test(hash) ? Buffer.from(hash, 'hex') : Buffer.alloc(64);
  return timingSafeEqual(key, expected) && algorithm === 'scrypt-v1';
}
export function username(input: string): string {
  const name = input.toLowerCase();
  ensure(/^[a-z0-9][a-z0-9._-]{2,79}$/.test(name), 'INVALID_USERNAME', 'Use 3–80 letters, digits, periods, hyphens or underscores.');
  return name;
}
export class Auth {
  constructor(private readonly db: PrismaClient, private readonly bootstrap: string) {
    ensure(bootstrap.length >= 32, 'CONFIGURATION_REQUIRED', 'A private server bootstrap token is required.');
  }
  async initialize(token: string, name: string, password: string, tenantName: string): Promise<{ userId: string; tenantId: string }> {
    ensure(timingSafeEqual(Buffer.from(digest(token)), Buffer.from(digest(this.bootstrap))), 'FORBIDDEN', 'Bootstrap authorization failed.');
    const normalized = username(name); const hash = await hashPassword(password);
    return this.db.$transaction(async (tx) => {
      await execute(tx, 'SELECT pg_advisory_xact_lock(34821001)');
      const count = await query<{ n: bigint }>(tx, 'SELECT count(*) AS n FROM user_accounts');
      ensure(count[0]?.n === 0n, 'BOOTSTRAP_CLOSED', 'This server is already initialized.');
      const userId = randomUUID(); const tenantId = randomUUID();
      await context(tx, userId, tenantId);
      await execute(tx, 'INSERT INTO user_accounts(id,username,password_hash) VALUES($1,$2,$3)', userId, normalized, hash);
      await execute(tx, 'INSERT INTO tenants VALUES($1,$2)', tenantId, tenantName);
      await execute(tx, "INSERT INTO memberships VALUES($1,$2,'owner',1,false)", tenantId, userId);
      return { userId, tenantId };
    });
  }
  async signIn(name: string, password: string): Promise<{ token: string; userId: string; username: string; expiresAt: string }> {
    const normalized = username(name);
    ensure(password.length <= 1024, 'AUTHENTICATION_FAILED', 'Credentials did not authorize this request.');
    const users = await this.db.$queryRawUnsafe<{ id: string; password_hash: string; disabled: boolean }[]>('SELECT id,password_hash,disabled FROM user_accounts WHERE username=$1', normalized);
    const user = users[0];
    const valid = await verifyPassword(password, user?.password_hash ?? '');
    ensure(user && valid && !user.disabled, 'AUTHENTICATION_FAILED', 'Credentials did not authorize this request.');
    const token = randomBytes(32).toString('hex'); const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);
    await this.db.$executeRawUnsafe('INSERT INTO cloud_sessions VALUES($1,$2,$3)', digest(token), user.id, expiresAt);
    return { token, userId: user.id, username: normalized, expiresAt: expiresAt.toISOString() };
  }
  async authenticate(token: string): Promise<Actor> {
    ensure(/^[a-f0-9]{64}$/.test(token), 'AUTHENTICATION_FAILED', 'Sign in to the cloud service.');
    const rows = await this.db.$queryRawUnsafe<{ id: string; username: string }[]>(
      'SELECT u.id,u.username FROM cloud_sessions s JOIN user_accounts u ON s.user_id=u.id WHERE s.token_hash=$1 AND s.expires_at>now() AND NOT u.disabled', digest(token));
    const user = rows[0]; ensure(user, 'AUTHENTICATION_FAILED', 'Cloud session expired or was revoked.');
    return { userId: user.id, username: user.username };
  }
  async signOut(token: string): Promise<void> {
    await this.db.$executeRawUnsafe('DELETE FROM cloud_sessions WHERE token_hash=$1', digest(token));
  }
  async tenants(actor: Actor): Promise<{ id: string; role: Role }[]> {
    return this.db.$transaction(async (tx) => {
      await context(tx, actor.userId, '');
      return query(tx, 'SELECT tenant_id AS id,role FROM memberships WHERE user_id=$1 AND NOT disabled', actor.userId);
    });
  }
}
export async function member(tx: Tx, actor: Actor, tenantId: string, companyId?: string): Promise<Member> {
  await context(tx, actor.userId, tenantId);
  const rows = await query<{ role: Role; version: number }>(tx, 'SELECT role,version FROM memberships WHERE tenant_id=$1 AND user_id=$2 AND NOT disabled FOR SHARE', tenantId, actor.userId);
  const row = rows[0];
  ensure(row && row.role in ROLE_PERMISSIONS, 'FORBIDDEN', 'No current membership authorizes this company.');
  if (companyId && row.role !== 'owner') {
    const allowed = await query(tx, 'SELECT 1 FROM company_access WHERE tenant_id=$1 AND company_id=$2 AND user_id=$3 FOR SHARE', tenantId, companyId, actor.userId);
    ensure(allowed.length, 'FORBIDDEN', 'Company access is not assigned to this account.');
  }
  return { tenantId, userId: actor.userId, role: row.role, version: row.version };
}
export function owner(membership: Member): void {
  if (membership.role !== 'owner') throw new AccountingError('FORBIDDEN', 'Owner permission is required.');
}
/** Tenant administration/enrollment always takes tenant then membership locks.
 * The initial nonlocking authorization avoids letting outsiders lock a tenant. */
export async function tenantOwner(tx: Tx, actor: Actor, tenantId: string): Promise<Member> {
  await context(tx, actor.userId, tenantId);
  const allowed = await query<{ role: Role }>(tx, 'SELECT role FROM memberships WHERE tenant_id=$1 AND user_id=$2 AND NOT disabled', tenantId, actor.userId);
  ensure(allowed[0]?.role === 'owner', 'FORBIDDEN', 'Owner permission is required.');
  await query(tx, 'SELECT id FROM tenants WHERE id=$1 FOR UPDATE', tenantId);
  const current = await member(tx, actor, tenantId); owner(current); return current;
}
