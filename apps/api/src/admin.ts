import { randomUUID } from 'node:crypto';
import { ensure } from '@erp/domain';
import type { Role } from '@erp/contracts';
import type { PrismaClient } from './generated/prisma/client.js';
import { hashPassword, member, owner, tenantOwner, username } from './auth.js';
import type { Actor } from './auth.js';
import { context, execute, query } from './db.js';
import { encode } from '@erp/contracts';

export class Administration {
  constructor(private readonly db: PrismaClient) {}
  async members(actor: Actor, tenant: string): Promise<unknown[]> {
    return this.db.$transaction(async (tx) => {
      owner(await member(tx, actor, tenant));
      return query(tx, "SELECT m.user_id AS id,u.username,m.role,m.version,m.disabled,coalesce(array_agg(a.company_id ORDER BY a.company_id) FILTER(WHERE a.company_id IS NOT NULL),'{}'::text[]) AS companies FROM memberships m JOIN user_accounts u ON u.id=m.user_id LEFT JOIN company_access a ON a.tenant_id=m.tenant_id AND a.user_id=m.user_id WHERE m.tenant_id=$1 GROUP BY m.user_id,u.username,m.role,m.version,m.disabled ORDER BY u.username", tenant);
    });
  }
  async tenant(actor: Actor, name: string): Promise<string> {
    return this.db.$transaction(async (tx) => {
      const id = randomUUID(); await context(tx, actor.userId, id);
      await execute(tx, 'INSERT INTO tenants VALUES($1,$2)', id, name);
      await execute(tx, "INSERT INTO memberships VALUES($1,$2,'owner',1,false)", id, actor.userId);
      return id;
    });
  }
  async addUser(actor: Actor, tenant: string, input: { username: string; password: string; role: Role; companies: string[]; reason: string }): Promise<string> {
    const name = username(input.username); const hash = await hashPassword(input.password);
    return this.db.$transaction(async (tx) => {
      await tenantOwner(tx, actor, tenant);
      for (const company of input.companies) {
        const exists = await query(tx, 'SELECT 1 FROM cloud_books WHERE tenant_id=$1 AND company_id=$2', tenant, company);
        ensure(exists.length, 'BOOK_NOT_FOUND', 'Assigned company must belong to this organization.');
      }
      const id = randomUUID();
      await execute(tx, 'INSERT INTO user_accounts(id,username,password_hash) VALUES($1,$2,$3)', id, name, hash);
      await execute(tx, 'INSERT INTO memberships VALUES($1,$2,$3,1,false)', tenant, id, input.role);
      for (const company of new Set(input.companies)) await execute(tx, 'INSERT INTO company_access VALUES($1,$2,$3)', tenant, company, id);
      await execute(tx, "INSERT INTO security_audit(tenant_id,id,actor_id,action,reason,details) VALUES($1,$2,$3,'member-created',$4,$5::jsonb)",
        tenant, randomUUID(), actor.userId, input.reason, encode({ userId: id, role: input.role, companies: input.companies }));
      return id;
    });
  }
  async updateUser(actor: Actor, tenant: string, target: string, input: { role: Role; disabled: boolean; expectedVersion: number; companies: string[]; reason: string }): Promise<void> {
    await this.db.$transaction(async (tx) => {
      await tenantOwner(tx, actor, tenant);
      const targets = await query<{ role: Role; disabled: boolean; version: number }>(tx, 'SELECT role,disabled,version FROM memberships WHERE tenant_id=$1 AND user_id=$2 FOR UPDATE', tenant, target);
      const prior = targets[0]; ensure(prior, 'MEMBER_NOT_FOUND', 'Membership was not found.');
      ensure(prior.version === input.expectedVersion, 'VERSION_CONFLICT', 'Membership changed; refresh before editing.');
      if (prior.role === 'owner' && !prior.disabled && (input.disabled || input.role !== 'owner')) {
        const owners = await query<{ n: bigint }>(tx, "SELECT count(*) AS n FROM memberships WHERE tenant_id=$1 AND role='owner' AND NOT disabled", tenant);
        ensure((owners[0]?.n ?? 0n) > 1n, 'LAST_OWNER', 'Keep at least one active owner.');
      }
      for (const company of input.companies) ensure((await query(tx, 'SELECT 1 FROM cloud_books WHERE tenant_id=$1 AND company_id=$2', tenant, company)).length, 'BOOK_NOT_FOUND', 'Assigned company must belong to this organization.');
      await execute(tx, 'UPDATE memberships SET role=$1,disabled=$2,version=version+1 WHERE tenant_id=$3 AND user_id=$4', input.role, input.disabled, tenant, target);
      await execute(tx, 'DELETE FROM company_access WHERE tenant_id=$1 AND user_id=$2', tenant, target);
      for (const company of new Set(input.companies)) await execute(tx, 'INSERT INTO company_access VALUES($1,$2,$3)', tenant, company, target);
      await execute(tx, "INSERT INTO security_audit(tenant_id,id,actor_id,action,reason,details) VALUES($1,$2,$3,'member-changed',$4,$5::jsonb)",
        tenant, randomUUID(), actor.userId, input.reason, encode({ userId: target, previous: prior, role: input.role, disabled: input.disabled, companies: input.companies }));
    });
  }
  async revokeDevice(actor: Actor, tenant: string, company: string, device: string, reason: string): Promise<void> {
    await this.db.$transaction(async (tx) => {
      owner(await member(tx, actor, tenant, company));
      await execute(tx, 'UPDATE devices SET disabled=true WHERE tenant_id=$1 AND company_id=$2 AND id=$3', tenant, company, device);
      await execute(tx, "INSERT INTO security_audit(tenant_id,id,actor_id,action,reason,details) VALUES($1,$2,$3,'device-revoked',$4,$5::jsonb)",
        tenant, randomUUID(), actor.userId, reason, encode({ companyId: company, deviceId: device }));
    });
  }
}
