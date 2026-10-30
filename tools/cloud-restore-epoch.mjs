// Run against a restored database BEFORE restarting its API. Does not repair missing financial history.
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
const { Client } = require('pg');
if (!process.argv.includes('--confirm-service-stopped') || !process.env.DATABASE_URL || !process.env.ERP_RECOVERY_REASON?.trim()) {
  throw new Error('Stop the API, preserve the restored backup, supply privileged DATABASE_URL and ERP_RECOVERY_REASON, then pass --confirm-service-stopped.');
}
if (process.env.ERP_RECOVERY_REASON.length > 2000) throw new Error('Recovery reason exceeds 2,000 characters.');
async function recover() {
const db = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
await db.connect();
try {
  const role = await db.query('SELECT rolname,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user');
  if (!role.rows[0]?.rolsuper && !role.rows[0]?.rolbypassrls) throw new Error('A trusted database recovery operator is required; never use the API runtime role.');
  await db.query('BEGIN');
  try {
    await db.query("SELECT pg_advisory_xact_lock(hashtext('erp-server-restore'))");
    const books = await db.query('SELECT tenant_id,company_id,epoch FROM cloud_books ORDER BY tenant_id,company_id FOR UPDATE');
    if (books.rowCount) {
      await db.query("INSERT INTO user_accounts(id,username,password_hash,disabled) VALUES('system-recovery-operator','system.recovery-operator','disabled-system-principal',true) ON CONFLICT DO NOTHING");
      const principal=await db.query("SELECT 1 FROM user_accounts WHERE id='system-recovery-operator' AND username='system.recovery-operator' AND password_hash='disabled-system-principal' AND disabled");
      if (!principal.rowCount) throw new Error('Reserved recovery principal conflicts; operator review required.');
    }
    for (const book of books.rows) {
      const epoch = randomUUID();
      await db.query('UPDATE cloud_books SET epoch=$1 WHERE tenant_id=$2 AND company_id=$3', [epoch, book.tenant_id, book.company_id]);
      await db.query("INSERT INTO security_audit(tenant_id,id,actor_id,action,reason,details) VALUES($1,$2,'system-recovery-operator','server-generation-rotated',$3,$4::jsonb)",
        [book.tenant_id, randomUUID(), process.env.ERP_RECOVERY_REASON, JSON.stringify({ companyId: book.company_id, previous: book.epoch, epoch, databaseRole: role.rows[0].rolname })]);
    }
    await db.query('COMMIT'); console.log('Rotated recovery epochs for ' + books.rowCount + ' companies. Clients must explicitly reconcile; immutable history was preserved.');
  } catch (error) {await db.query('ROLLBACK'); throw error;}
} finally {await db.end();}
}
void recover().catch((error) => {
  const code=typeof error.code==='string' && /^[A-Z0-9_]{1,50}$/.test(error.code) ? error.code : 'OPERATOR_REVIEW';
  console.error('SERVER_RECOVERY_FAILED ('+code+'): no changes acknowledged; preserve recovery evidence and review configuration/constraints.');
  process.exitCode=1;
});
