# Database implementation

Status: SQLite v2, PostgreSQL migrations 001–004 and the Phase 5 IndexedDB adapter exist. Current verification/approval is in [phase status](../progress/phase-status.md); final Phase 5 gates remain in progress.

## Local SQLite

[001.sql](../../apps/desktop/src-tauri/migrations/001.sql) establishes the local owner vault, scoped book/revision snapshots, periods, ledgers, finalized journals/lines, immutable receipts/audit and outbox. [002_sync.sql](../../apps/desktop/src-tauri/migrations/002_sync.sql) preserves v1 receipt order/payloads while adding typed commands, delivery states/leases/backoff, cloud profiles, metadata intents, enrollment/join intents, append-only sync events and resolution links.

Amounts bind exactly as SQLite signed-64 integers; native aggregate validation uses i128, shared reports bigint. Every connection reads back WAL, synchronous=FULL, foreign_keys=ON and a five-second busy timeout. BEGIN IMMEDIATE plus revision CAS serializes source commits across windows/processes. Posting, receipt, audit and outbox commit together.

Source journal/receipt/audit projections remain immutable. Canonical cloud snapshots are separate JSON records: applying a snapshot updates only compatible local masters plus the mirror, outcomes and cursor. Shared-master responses do not fabricate local-owner financial audit events. Source books can omit other devices' journals; operational reporting uses the separate projection described in [sync](offline-sync.md).

Migrations are transactional, rechecked under the writer lock and reject newer schemas. Startup validates exact schema, SQLite integrity/FKs and source projection reconciliation. A Windows file lock protects short native operations and restore across processes; HTTPS never runs under that lock. Full-copy book validation, 16 MiB source/request limits, a 17 MiB encoded IPC cap, 18 MiB native response cap and 128 MiB backup cap bound this version; large-book performance is unproven.

## PostgreSQL

The Node service uses Prisma 7's PostgreSQL adapter and parameterized raw SQL inside Prisma transactions. [Prisma schema](../../apps/api/prisma/schema.prisma) supplies the generated client; authoritative physical constraints/policies are the forward SQL migration files under `apps/api/prisma/migrations`. No Prisma-generated schema diff replaces their triggers/RLS.

| Tables | Responsibility |
| --- | --- |
| user_accounts, cloud_sessions | Salted password hashes and hashed expiring opaque session tokens; trusted authentication boundary |
| tenants, memberships, company_access | Organization roles/versions/disable state and explicit non-owner company assignments |
| cloud_books, devices | Scoped snapshot/revision/cursor/epoch and registered user/device/source/generation |
| cloud_periods, cloud_ledgers | Scoped posting references and valid inclusive date ranges |
| cloud_journals, cloud_lines | Immutable finalized headers/positive BIGINT lines with composite scope FKs |
| command_outcomes, cloud_audit, cloud_changes | Immutable command result, accounting audit and gap-free as-of change snapshot/outcome |
| enrollment_receipts, enrollment_cancellations | Idempotent reviewed import or immutable cancellation tombstone; tenant-locked serialization |
| security_audit | Append-only membership, device and operator recovery events |

Migrations: 001 foundation; 002 security audit/timestamps/company-access FK; 003 rejected-root replacement links and one accepted replacement per root; 004 enrollment cancellation. Never edit an applied migration; add a forward migration. The engineering cluster records SHA-256 checksums with normalized LF line endings and refuses changed files. Git attributes keep SQL/native source line endings stable across Windows checkouts. Existing pre-checksum engineering entries received a one-time current-file baseline; this is not an independently proven historical hash.

RLS is enabled and forced on tenant/financial tables. The runtime role is LOGIN, NOSUPERUSER, NOCREATEDB, NOCREATEROLE and NOBYPASSRLS, and owns no tables. Startup refuses an owner/bypass role. Transaction-local app.user/app.tenant context and company-access policies prevent pooled context leakage and unauthorized financial rows; no context means no financial rows. API authorization also checks active membership/action permissions.

A company row lock serializes posting, master versions and cursor allocation. Membership/assignment share locks order authorization against revocation. Deferred PostgreSQL triggers require finalized journals with 2–1,000 balanced lines; NUMERIC sums avoid BIGINT aggregate overflow. Triggers prevent posted header/line edits and outcome/audit/change/enrollment mutation. Period CHECK rejects end-before-start; posting guards check date and current open period/version. The reviewed-import path alone permits valid historical journals in locked periods, while preserving range/balance checks.

## Local development operations

This host's ignored portable PostgreSQL 18.6 bin/lib/share tree is under `.cache/postgresql`. `npm run db:start` initializes or reuses `.cache/cloud/pgdata`, binds 127.0.0.1:55438, uses SCRAM and applies migrations with an engineering administrator. It creates erp_cloud and a separate erp_runtime role. No external service or Windows service is provisioned.

Random development passwords, bootstrap token, signing PEM and API environment live in ignored `.cache/cloud`; do not print, commit or ship them. Their file protection relies on the Windows account and is development configuration, not production secret custody. `npm run db:stop` requests a clean stop. Existing accounts/data are never reset by startup.

After `npm run build`, `npm run api:start` loads the ignored environment file and binds the development API to loopback port 4318. Initialize its first owner once with authenticated bootstrap token and chosen username/password/tenantName at POST /v1/auth/bootstrap. No default account exists. Subsequent owner-created users/assignments use scoped member POST/PUT APIs; membership edits carry expectedVersion/reason. Revoke a device through its scoped owner endpoint. There is no public deployment in this phase.

Real integration tests create a random `erp_verify_<16 hex>` database, apply the actual migrations, use the real non-owner runtime role/HTTP/native harness, and drop only that checked fixture database. Development and owner stores are never substituted for fixtures.

## Recovery

Local OnlineBackup creates a consistent snapshot; ERPBAK01 encrypts/authenticates it before export. Restore decrypts into a separate candidate, upgrades supported v1 to v2 transactionally, validates integrity, rotates vault generation, pauses cloud profiles and atomically copies it into place. Wrong passphrase/tamper/failure preserves the current store. Temporary plaintext relies on Windows temporary-directory access; secure erasure or power-loss residue removal is not promised.

After PostgreSQL restoration, keep the API stopped. Preserve backup/evidence and the original signing key. Supply a privileged operator DATABASE_URL and ERP_RECOVERY_REASON, then run:

```sh
node tools/cloud-restore-epoch.mjs --confirm-service-stopped
```

The operator tool rotates company epochs and appends reasoned security events atomically. A disabled system principal identifies this operator action, with the actual database role in event details; it cannot sign in interactively and does not impersonate an owner. The tool neither edits immutable history nor repairs lost postings. Clients must explicitly reconcile snapshots/receipts, and refuse missing accepted history. Production database backup encryption, PITR scheduling, recovery environment, retention and measured RPO/RTO remain Phase 9/10 gates.

## Common model

Tenant/company composite identity is mandatory. Company base currency/exponent/books beginning are immutable under ordinary commands. Financial years/periods are real inclusive business-date intervals. Canonical JSON amounts are integer strings; driver conversion to JS Number is forbidden. Report accumulators may exceed individual persisted signed-64 lines.

Invoice/party/stock/tax entities and FX/quantity precision remain later-phase designs, not existing tables.

## Browser IndexedDB

The origin-scoped `erp-browser-workspace` database uses schema version 2. `meta` holds one vault/credential verifier/generation. `books` holds scoped source snapshots/revisions; `outbox` holds one typed command/delivery record per immutable receipt; `profiles` holds separate canonical snapshots, cursor/epoch, device/account/key/grant bindings, authority revision and leases. `intents`, `enrollments` and `joins` retain stable reviewed requests across interrupted HTTP. `resolutions` retains compensation/replacement links; `events` retains local sync/recovery evidence. Company indexes support scoped queue access. Bearers and plaintext passwords are absent from every store and backup.

An unreleased version-1 engineering schema is upgraded transactionally by adding events/company indexes; this is a tested upgrade fixture, not a claim of a deployed earlier browser product. A blocked upgrade times out visibly after five seconds without deleting data. `versionchange` closes the old connection, locks its runtime and demands reload; opening newer unsupported schemas fails closed.

The host reads a source/revision/authority frame, validates strict wire/domain invariants and independently replays the proposed command through the shared application outside any IDB transaction. A short readwrite transaction rechecks vault generation, source revision, authority revision/expiry and appends book/journal/receipt/audit/outbox atomically. Multi-tab writers retry revision conflicts through the shared CAS adapter. All acknowledgment waits for `transaction.oncomplete`; request success alone never acknowledges a save. Crypto, HTTP and timers stay outside transactions; callbacks may await IDB requests only. Strict durability is requested/read back, with a declared default fallback where the option is unsupported.

Browser backups use a consistent read-only snapshot of all nine stores, authenticated encryption outside the transaction, and an external download. Restore decrypts and checks schemas, unique keys, scopes, source receipt/outbox reconciliation and canonical bindings before a single replacement transaction. It rotates the vault generation, pauses profiles and clears interrupted delivery leases. Wrong keys, tampering, malformed metadata and transaction failures retain the current vault. Read [security](security.md) for the distinct ERPWEB01 format and plaintext storage limitations.

Storage estimates/persistence requests are explicit conveniences, not disk reservations. Quota failures report no successful save; site-data removal or private-window closure can erase the whole vault. There is no reliable first-use-versus-total-eviction distinction after every origin store has been deleted. Users must retain external backups; the UI discloses this. Actual policy-driven eviction and power-loss hardware assurance are not claimed by controlled data-removal/crash fixtures.
