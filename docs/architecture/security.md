# Security model

Status: Phase 2 implements permission/scope checks for trusted supplied principals, scoped append-only audit/receipt data and in-memory financial commit guards. Tests cover unauthorized operations, foreign tenant/company data, posted-record edits, duplicate commands and stale versions. This is application policy, **not authentication**: the host must establish identity/membership before constructing Principal. No encryption, sessions, RLS, native capabilities, durable audit retention or production security boundary exists. No security certification is claimed.

## Trust boundaries and threats

| Boundary / threat | Planned control | Verification gate |
| --- | --- | --- |
| Browser or renderer sends forged scope/role/amounts | Server-authenticated identity, scoped authorization, shared domain validation, bounded schemas; never trust role fields from payload | Phase 4/API and Phase 5 web |
| Cross-tenant IDs/joins leak records | Tenant/company composite FKs, query scope, authorized exports/change feeds and non-bypass RLS role | Phase 4 real DB tests |
| WebView script gains OS/SQL access | Packaged original assets, strict CSP, minimal Tauri capabilities, narrow typed native commands; no arbitrary path/shell/SQL IPC | Phase 3 |
| Lost desktop or copied DB | OS account controls and scoped file permissions; evaluate maintained DB encryption and OS-backed key custody; no plaintext password/token storage | Phase 3 design and tests |
| User controls local clock/files/browser | Offline trust limitations disclosed; scoped grants, clock rollback detection where possible, mandatory server revalidation | Phase 3/4 |
| Session theft / web injection | Secure HttpOnly SameSite cookies where applicable, CSRF protection for cookie mutations, output escaping/CSP, session rotation/revocation | Phase 4/5 |
| Duplicate/replayed/modified financial requests | Scope-bound immutable command receipts, canonical digests, atomic posting, immutable journals and locked periods | Phases 2–4 |
| Backup theft/tampering / lost keys | Maintained authenticated encryption, separate recovery material, integrity check and restore drill; no home-grown encryption | Phase 3 local; 4 cloud; 9 drills |
| Sensitive diagnostics/exports | Minimal structured logs, redaction, scoped export permissions and retention; no credentials or full transaction payload logging by default | Every implementation phase |
| Compromised update/dependency | Pinned lockfiles, provenance/license review, limited dependency surface; signed Windows release/update path | Admission gates; Phase 10 |

Tauri explicitly separates the privileged native core from the WebView; permissions must follow that boundary. Its presence alone does not make the application safe. [Tauri security model](https://v2.tauri.app/security/)

## Identity and authorization proposal

Proposed roles: Owner (membership/configuration), Accountant (post/reverse/report; close period only if separately granted), Data Entry (draft; posting only when explicitly permitted), Viewer (read permitted companies/reports). Permissions are action- and company-scoped, not UI visibility checks. Export, backup, restore, period reopen and member administration require explicit rights and audit reasons. System administration does not imply permission to rewrite financial history.

Local-only users can unlock an encrypted local vault using a vetted password/KDF design; local authentication is separate from any future cloud session. Do not claim that self-hosted auth automatically supplies offline sign-in. A synchronized device must be explicitly enrolled and provisioned with narrowly scoped offline permissions. Provider choice, grant duration, renewal and password recovery are open decisions.

Offline authorization cannot guarantee immediate remote revocation or protect against a malicious OS administrator. Proposed expiry behavior: after grant expiry deny new synchronized postings while preserving permitted read/export/recovery; allow draft preparation only if policy permits. Reconnection revalidates permissions and period state. Owner must approve the offline duration, clock handling and local-only recovery policy before Phase 3.

Server sessions authorize every API call, snapshot, cursor and export. Tenant/company context derives from verified membership, never just route/body identifiers. Cloud runtime DB role is not owner, superuser or BYPASSRLS; tenant context is transaction-local under pooling. Owners typically bypass RLS, so tests must use the actual runtime role. [PostgreSQL row security](https://www.postgresql.org/docs/18/ddl-rowsecurity.html)

## Secrets, storage and backups

- No DB credentials or long-lived cloud secrets in browser bundles, repositories, fixtures or logs. Browser localStorage is not credential custody. Native tokens belong in an approved OS credential facility, with a documented recovery model.
- SQLite is not encrypted merely because it is local; IndexedDB is accessible to authorized origin scripts and user/browser tooling. Device theft and XSS are explicit threats. Product UI must state actual protection, not implied encryption.
- Backups require authenticated encryption with versioned manifests, schema/scope metadata, integrity verification, safe path admission and resource limits. Recovery key loss and passphrase reset cannot be solved by silently weakening encryption. Browser backup encryption must use vetted Web Crypto primitives with reviewed key derivation.
- Restore validates a separate copy before switching stores. Preserve pending commands, receipt uniqueness and device-generation recovery. Backups live outside the source tree; ignore rules are a guardrail, not a secret scanner.
- Audit append-only events record actor/device/scope, business action, linked command/journal, reason and trusted server timestamp when available. Local clocks/events are not tamper-proof proof. Retention and access policy require owner approval.

## Accounting protections and review status

Posted financial records are immutable at the domain, persistence and server authorization boundaries. Reversal, period reopen and rejection reconciliation preserve original evidence. Server-authoritative acceptance never deletes a rejected local posting. Transactions must protect against concurrent period changes and duplicate commands.

Phase 1 review found no business data, credentials or copied application assets. Certificate metadata was structurally parsed, not cryptographically verified. The owner's synthetic company/date findings remain attributed, with exact retained values and individual defaults unverified. Phase 2 reused the original specification and owner-directed official vendor docs; no native decompilation, security bypass, new launch or production company action occurred. Tests verify the scoped trusted-principal/reference-adapter boundaries, not network authentication, encryption, DB isolation or adversarial OS protection. npm audit reported zero known vulnerabilities at the check; this is not a comprehensive security verdict. Further runtime tests are in [test strategy](../testing/test-strategy.md).
