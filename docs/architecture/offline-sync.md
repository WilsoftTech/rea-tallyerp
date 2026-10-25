# Offline operation and synchronization

Status: synchronization remains **proposed, not implemented**. Phase 2 implements exact canonical actor/command payload comparison, scoped receipts and transactional journal/audit contracts with an in-memory reference adapter. No durable local store, outbox, sync worker or server exists. A Phase 2 posting result is a logical in-memory commit, not a durable offline or cloud acknowledgment. Requirements below describe future integration and are not claims about Tally behavior.

## Authority and states

Journal posting state and synchronization state are separate. A draft is editable; a locally posted journal is immutable. In local-only mode it is authoritative for that standalone book and has `not-enrolled` sync state. In synchronized mode it is locally durable but remains `pending` until the server accepts it. UI and exports must never equate local acknowledgment with cloud acceptance.

| Sync state | Meaning | Permitted transition |
| --- | --- | --- |
| not-enrolled | Standalone local book, no cloud confirmation expected | Explicit enrollment/reconciliation only |
| pending | Committed locally with receipt, audit and durable outbox command | sending |
| sending | Bounded attempt in progress; persisted lease expires after interruption | accepted, pending retry, rejected, conflict |
| accepted | Matching server receipt/canonical reference persisted locally | Terminal for that command |
| rejected | Server has durably rejected a command, e.g. no current authority | Terminal command outcome; remediation creates a new linked command |
| conflict | Expected version/period/dependency is stale and needs resolution | Explicit resolution; original receipt remains immutable |

Timeouts, disconnects and unknown HTTP outcomes are retryable/unknown, not proof of rejection. If the server committed and its response was lost, retry the **same command ID and payload**. An accepted command's result remains accepted even if the actor later loses posting rights; retrieving it still requires appropriate authorized access.

## Command envelope

Proposed fields: protocol version; command ID; device ID/generation; authenticated tenant/company scope; command kind; immutable local journal/document ID; company business date; actor context; expected period/master versions; explicit dependency command IDs; canonical payload and digest. Created-at timestamps support audit only; they do not grant permission or determine ordering.

Canonical serialization defines sorted keys, integer strings, date representation, allowed Unicode/text rules and protocol version before payload hashing. The server computes its own digest and enforces a unique `(tenant, company, commandId)` receipt. Reuse with a different payload returns an idempotency error; no second posting. Authenticate and authorize scope before exposing receipt existence or result. Reject unknown protocol versions explicitly without discarding local work.

## Local atomic sequence

1. Read/validate draft, company, period, ledgers and offline authority using shared application/domain logic.
2. In one SQLite/IndexedDB transaction, recheck expected versions and lock state; claim command ID; write immutable posting, audit event, receipt and outbox. A local-only store records its receipt but need not enqueue for a nonexistent server.
3. Acknowledge local success only after transaction commit succeeds. A storage/quota/commit error is not a successful save.
4. Network coordination happens outside the database transaction, in bounded batches with dependencies sent first. Use exponential backoff/jitter, bounded leases and explicit error classes; reconnect/app-open triggers are sufficient initially.

## Server atomic sequence

1. Authenticate current actor/device, authorize tenant/company and validate bounded protocol payload. Client-reported identity/role is not trusted.
2. Begin a DB transaction, acquire scope/idempotency protection and load current trusted master/period/permission versions. Receipt concurrency uses a unique key and deterministic conflict handling.
3. Return an authorized existing same-payload receipt or validate domain invariants against current state. Posting and period-closing share locks; no pre-check-only race.
4. Commit journal, receipt, audit event and company change sequence atomically. Stable validation rejection/conflict outcomes are retained without a partial journal; transient server failure rolls back for retry.
5. Return the canonical journal identity, accepted scope and durable change cursor. Persist acknowledgment/mapping locally transactionally; interrupted acknowledgment handling safely retries.

Delivery is at least once; transactional idempotency provides one financial effect per command. Do not describe the network as exactly-once delivery. Retention of receipts must cover supported retry/restore windows; permanent posting receipts or archival uniqueness prevent old duplicates after backup restoration.

## Conflict policy

| Situation | Required behavior |
| --- | --- |
| Period locked after device went offline | Preserve local posting as exception; do not silently move its date. Accountant resolves with an authorized new-period linked correction where appropriate |
| Role/device revoked while offline | Revalidate at reconnect; reject new acceptance where unauthorized; preserve evidence and access to permitted recovery/export |
| Master renamed/edited concurrently | Version check, explicit merge or revalidation for mutable master fields; do not silently change accounting nature or referenced snapshot |
| Same command resent / response lost | Return same authorized durable result; no duplicate journal |
| Two different commands appear to represent the same business transaction | Command IDs alone cannot detect semantic duplicates; reference uniqueness and review are separate requirements |
| Reversal depends on unaccepted original | Wait for dependency acceptance or raise explicit conflict; never create orphan cloud reversal |
| Offline duplicate invoice numbers / stock issues | Provisional per-device numbering and explicit allocation/stock policy; no global uniqueness/availability guarantee without coordination |
| Posted financial conflict | No last-write-wins; preserve both evidence and acceptance outcomes, resolve through linked commands/reversals |

If a locally posted command is rejected, do not delete or overwrite its journal. Local operational books can include it with clear exception status; the accepted cloud book excludes it. Corrections must identify which book they affect, link original/corrective records, and avoid sending a reversal for a cloud journal that never existed. A resolution may retain a local-only compensating entry and submit a fresh authorized replacement. Every such path requires hand-worked reconciliation tests and accountant approval in Phase 4.

## Incremental pull and recovery

Use a server-assigned monotonic per-company change cursor with explicit database generation. Apply each batch and its new cursor atomically; duplicate changes are harmless by stable IDs/version. Handle gaps, expired cursors and changed generations with an authorized consistent snapshot and watermark, then resume. Pagination order is server-defined, not device time. Pull canonical objects without overwriting a separate pending local overlay. Tombstones apply only to deletable drafts/masters; journals are never removed by a sync tombstone.

Server receipt + change feed must appear in the same transaction. Protect the feed/snapshot by the same company/role authorization as normal APIs. Dependency ordering, bounded batches, schema negotiation and partial failures are explicit protocol concerns. Binary attachments are out of initial sync scope.

On backup restore, retain original command IDs/payloads, establish a new device generation, reconcile receipts and accepted IDs, detect cloud/local generation mismatch, and replay only known unacknowledged commands. Server rollback requires its own recovery epoch and client reconciliation; an old cursor must not silently skip changes. Enrollment of local-only books requires balances/identities/dependencies to be reviewed before any bulk acceptance.

Browser service workers cache a versioned shell, not unrestricted authenticated API responses. First visit requires connectivity; quota denial/eviction, user data clearing and private modes can lose unsynchronized data. Request persistence and report quota/backup status, but do not promise permanence. Explicit export and desktop backup remain necessary. [MDN storage limits](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)

Verification is planned in [test strategy](../testing/test-strategy.md): lost response, duplicate command races, reversed ordering, lock/revocation conflicts, interrupted local commit/apply, browser quota and restored generations. None has run yet.
