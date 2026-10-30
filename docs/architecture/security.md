# Security implementation and limits

Status: native controls, authenticated service and Phase 5 browser controls exist. Current checks/approval are in [phase status](../progress/phase-status.md); final Phase 5 verification is in progress. This is scoped engineering verification, not certification or the comprehensive Phase 9 audit.

## Trust boundaries

The packaged React renderer has no SQL, shell, arbitrary filesystem, general HTTP or remote-content capability. Its sole main-window accounting IPC admits bounded named operations. CSP allows packaged scripts and IPC only. Native storage fixes the local vault path, derives its tenant/local-owner actor and checks immutable accounting transitions; renderer role assertions do not grant authority.

Local authentication uses salted Argon2id, random native-memory tokens, a 15-minute native limit between authorized operations and failed-unlock delay. The renderer independently locks after 15 minutes without keyboard/pointer activity, including while foreground synchronization is running. Each vault has one local owner; its password is not a separate per-person cloud login. Offline authority follows the enrolled account/device grant. SQLite is **not encrypted**: protect the Windows account and disk. An OS administrator can edit files, clocks or the executable. Device authentication does not make a copied plaintext database confidential or tamper-proof.

Cloud tokens stay in native memory, clear on lock/sign-out/process exit and are never returned to the renderer or included in backups. Login passwords are bounded and cleared from forms after successful use; transient process/page memory is not guaranteed securely erased. No persistent refresh token or OS credential-manager integration is claimed.

Native transport validates the selected HTTPS origin, permits HTTP only for loopback development, blocks redirects/proxy inheritance and bounds connection/request/body/response resources. It exposes specific accounting routes, not arbitrary renderer requests. Public service listeners require TLS; the development listener is loopback HTTP. Public hosting, production TLS/proxy deployment and signing remain separate release work.

## Service authentication and roles

Node crypto implements salted asynchronous scrypt (N=32768,r=8,p=1,64-byte output); unknown users run a dummy verification path. Password comparison is constant-time. KDF concurrency, login rate, connections, active requests, body size and request time are bounded. Eight-hour opaque random session tokens are stored only as SHA-256 hashes and checked against expiry/current account state on every request. Logout revokes the hashed session.

The first owner requires a one-time bootstrap token and serialized empty-account check. No default user/password is seeded. Owner-created accounts and membership/company assignments require scoped authorization and reasons; version checks and last-owner protection prevent accidental lockout. Device revocations and recovery/membership actions are audited. Password reset, MFA, federation and commercial onboarding are not implemented or claimed.

| Role | Current company permissions |
| --- | --- |
| owner | Read/post/reverse/draft, chart/period management and reopen; member/device administration |
| accountant | Read/post/reverse/draft, chart management and period close; no reopen or membership administration |
| entry | Read and save drafts |
| viewer | Read only |

Non-owners need explicit company assignment. The API builds trusted principals from current authenticated membership; body actor/permission fields retained for historical compatibility never authorize requests.

The PostgreSQL runtime role cannot own tables, act as superuser or bypass RLS. Policies force scoped financial access; transaction-local context is set under pooling. Membership/assignment locks serialize revocation against financial transactions. Composite FKs, range checks, immutable triggers and deferred balancing provide additional persistence defenses. Authentication tables belong to the trusted server boundary and are not exposed through generic CRUD/SQL endpoints.

## Offline authority and integrity

Owner-approved signed grants last at most **24 hours** and bind user, source/cloud scopes, device, vault generation, server epoch, permissions and membership version. Native Ed25519 verification uses the pinned service key and checks signature/bindings/duration/expiry/clock observations. A monotonic process anchor detects clock freezing while alive. Expiry retains device read/encrypted backup and denies synchronized writes; local-only companies remain independent.

Immediate disconnected revocation and protection from a malicious OS clock/executable are impossible here. Online company/device withdrawal pauses writes; a session-expiry 401 clears live login without fabricating a financial rejection. Explicit sign-out pauses synchronized writes. Restoring a backup rotates generation and requires reviewed online reconciliation; source IDs and accepted evidence are preserved.

Server posting reruns shared accounting, permissions and current period/chart/draft versions. Outcomes/journals/audit/cursor are atomic; duplicate IDs with altered content are rejected. Local posted records remain immutable even when rejected by the cloud. Resolution uses reasoned device compensation and new linked replacement commands, with at most one accepted replacement per rejected root. Unknown responses cannot be treated as failed financial commands.

## Secrets, backup and diagnostics

Database credentials, bootstrap authorization and signing private keys stay in native/server configuration, outside source and browser assets. The ignored local development configuration relies on Windows file protection; production secret/key custody, rotation, residency and retention need release configuration. Signed public grants are nonsecret permissions and can be backed up; bearer tokens cannot.

ERPBAK01 uses authenticated AES-256-GCM, a fresh 16-byte salt/12-byte nonce and Argon2id v19 (19 MiB, two passes, one lane, 32-byte key). A separate passphrase is unrecoverable if lost. Backups include the historical device-password hash. Restore validates a separate candidate before atomic replacement and invalidates old sessions/generations. Plaintext temporary files rely on Windows account access and normal cleanup, with no secure-erasure guarantee.

Server errors expose bounded structured codes/messages, not SQL, credentials or stored payloads. Tests use synthetic stores/accounts. Dependency audit sends only published package identities; it is not a secret scanner or penetration test. Append-only audit/event rows are application/persistence controls, not protection against a privileged database/OS operator.

## Remaining assurance boundaries

Known-advisory checks cover pinned npm and native graphs, distinguishing non-Windows findings from the actual Windows build. Production installation/update signing, independent adversarial testing, password recovery/MFA, hardware-backed local custody, large-scale abuse/concurrency campaigns, production TLS and database backup/PITR drills remain later gates.

Tally research remains lawful read-only metadata/public docs and owner-reported synthetic observations. Unobserved UI behavior stays NOT VERIFIED; our security/accounting tests are independent ERP evidence.

## Browser boundaries and recovery

IndexedDB is **plaintext** origin storage. A device password gates ordinary app operations; it cannot protect financial records from DevTools, malicious extensions, same-origin script compromise, copied browser files or an OS administrator. Do not host unrelated/untrusted applications on this origin. Clearing site data/private-window closure/eviction may erase it; storage persistence permission is not a backup or a guarantee. User-controlled clocks and immediate disconnected revocation remain limitations.

The local verifier derives a nonextractable AES-256-GCM key with native Web Crypto PBKDF2-HMAC-SHA256, 600,000 iterations and random 16-byte salt. It authenticates an encrypted fixed credential-check string with a random 12-byte IV and context AAD; the password/key is not stored. This is a salted credential verifier, **not database encryption**. Setup/backup passphrases are 12–1,024 characters. Unlock permits one KDF at a time plus a two-second failure delay; hostile same-origin code can bypass UI throttling and read plaintext records, so no offline attack-proof claim is made. KDF choice uses the [OWASP PBKDF2 guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html); this is not compliance certification.

The browser backup format is **ERPWEB01**, distinct from native ERPBAK01: a 40-byte authenticated header contains magic, fixed KDF count, fresh 16-byte salt and 12-byte IV; AES-256-GCM adds a 16-byte tag. The same native Web Crypto KDF derives the backup key from a separate passphrase; input/output is bounded at 128 MiB. Credentials and public grants are backed up, cloud bearer tokens are not. Decryption/schema/financial/metadata validation precedes atomic IDB replacement; then generation rotation, session invalidation and cloud recovery restrictions apply. Downloads acknowledge initiation, not guaranteed OS-file persistence; the user must confirm the external file exists. Forgotten backup passphrases cannot be recovered.

The public shell has no account/company state in SSR/RSC or Cache Storage. The worker has an explicit build allowlist because the [Cache API does not itself honor HTTP cache headers](https://developer.mozilla.org/en-US/docs/Web/API/Cache). Only exact same-origin GET shell/static paths are served from it; API paths, mutations, RSC requests and arbitrary URLs bypass it. Worker installation failure deletes only its candidate cache. Updates wait for all old tabs to close, preserving IDB records; schema changes close stale clients without deleting the database.

The Next server's fixed-origin proxy receives only explicit bearer/JSON requests, never forwards cookies, blocks redirects/bootstrap, enforces bounded route parts/body/response/time, rejects foreign Origin headers and marks responses no-store. Database credentials and signing private keys never enter client assets. No cookie authentication or CSRF token library is needed for this explicit-bearer design; server authentication/authorization remains authoritative. CSP limits scripts/network/workers to self, disallows framing/objects/base URLs, and React escapes text. Static Next bootstrap currently requires inline scripts/styles; this CSP is not a nonce-based strict-XSS policy. No arbitrary HTML rendering exists, and a future nonce redesign must preserve offline public-shell behavior.

Supported modes are current verified Windows Chrome/Edge/Firefox on HTTPS or loopback, with IndexedDB, Web Crypto and service workers. Unsupported crypto/storage contexts fail visibly; an unavailable Ed25519 implementation denies synchronized posting while retaining read/backup. Safari/mobile and human assistive-technology trials are not claimed. Actual end-to-end browser/source/proxy/storage/update checks belong to Phase 5 evidence, separate from reference Tally observations and later independent adversarial review.
