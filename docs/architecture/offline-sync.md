# Offline operation and synchronization

Status: protocol 1 serves native SQLite and Phase 5 browser IndexedDB hosts through the same PostgreSQL authority. Current verification/approval is in [phase status](../progress/phase-status.md). No external deployment occurred.

## Authority and durable records

Local-only companies remain authoritative standalone books with `not-enrolled` outbox records. Enrollment is explicit, owner-authorized and reviewed: the native host freezes a fixed import intent before HTTP, preserves all original local history and pins the authenticated service's public signing key. Imported actors are historical owner-reviewed evidence, not proof of original cloud authorization.

Lost enrollment responses retry the same intent and frozen snapshot. Financial work created afterward remains local and queues after acceptance; shared-master edits wait. An existing target company produces COMPANY_ALREADY_EXISTS and requires a deliberate join or another reviewed target. Cancelling a pending import first records a server cancellation tombstone under the same tenant lock as enrollment, refusing cancellation if already accepted. Only a confirmed cancellation releases the local intent; delayed old requests cannot import afterward.

Joining an existing company registers a distinct device/source scope and atomically creates an empty local source book, shared masters and separate accepted mirror. It never replaces another local book or silently replays an old untyped backup.

## States and command identity

| State | Meaning |
| --- | --- |
| not-enrolled | Standalone work, or an explicitly designated device-only compensation; no cloud acceptance |
| pending | Atomic local commit awaiting authorized delivery/retry |
| sending | Persisted delivery lease and attempt count; an interrupted worker can be reclaimed |
| accepted | Matching durable server receipt was recorded |
| rejected | Authorized server processing retained a stable business/permission rejection |
| conflict | Server retained a stale version, period, dependency or identity conflict requiring review |

The immutable source posting state and mutable delivery metadata are separate. Protocol envelopes contain device ID, vault generation, server epoch, typed command, dependency IDs and an optional rejected-root replacement link. Amounts are canonical integer strings. New receipts retain typed commands; old opaque payloads are never guessed into financial commands.

Server idempotency binds tenant/company/command ID to authenticated user, device, command content, dependencies and replacement link. A changed payload is an explicit conflict. Transport generation/epoch can change during reviewed recovery without changing the financial command identity. Retrieving a prior outcome still requires current authorized company/device access.

The server locks the company and writes outcome, accepted journal/audit, state and next gap-free cursor in one PostgreSQL transaction. Stable domain failures get terminal outcomes; SQL/transient failures roll back everything and remain unknown/retryable. Server authorization and period/chart/draft versions are checked at processing time.

## Native transport and retry

Cloud bearer tokens live only in native memory; no arbitrary fetch/header/SQL RPC exposes them to the renderer. Transport accepts a selected HTTPS origin, loopback HTTP for development, no credentials/path/query in the origin and no redirects. Connect/request timeouts are 5/15 seconds; body and response sizes are bounded.

The coordinator uses short native/OS-file/SQLite locks for planning and applying, with network I/O outside every such lock. A persisted company/delivery lease lasts 60 seconds and is refreshed per attempt. Work uploads in local receipt order; dependencies make unsafe ordering explicit. Attempts use bounded exponential backoff up to 64 seconds, with server Retry-After honored up to 300 seconds. Up to 100 commands/batches are processed per invocation; remaining work stays queued. Manual sync and a 30-second visible, unlocked, signed-in foreground check resume work; there is no background service.

Timeout, disconnect, HTTP 500 or lost acknowledgment does not mean rejection. Retry the original ID/payload, or discover its accepted receipt through pull. A 401 clears the live session without inventing a financial result; an unexpired grant can still authorize offline work. Known company/device revocation pauses synchronized writes. Sign-out explicitly pauses them; local-only companies remain independent.

## Offline permission policy

The owner selected a maximum **24-hour** grant after online authorization. Ed25519 signatures bind protocol, user, cloud/source scopes, device, vault generation, epoch, permissions, membership version, issuedAt and expiresAt. Native verification checks the pinned key, signature, bindings, duration, expiry and observed clock rollback. A monotonic process clock also detects clock freezing/rollback while the process remains alive.

Expired or invalid grants retain device read and encrypted backup, and deny financial writes. Shared chart/calendar/period edits require the online service, with a durable metadata intent for retry; they are not optimistic offline edits. Existing shared ledger/group classification and referenced period/year definitions cannot be destructively merged. Local-only master editing keeps its prior behavior.

Disconnected revocation and malicious OS clock/file/executable control cannot be eliminated by these grants. No hardware-backed clock or secret custody is claimed. Reconnection rechecks current membership, assignments, device and locks.

## Canonical pull and reports

Pull requests carry epoch, after-cursor and batch limit 1–50 (native uses 20). The service verifies contiguous changes, bounds outcome bytes and returns one snapshot exactly as of the last returned cursor; hasMore resumes later. Native stores canonical snapshot, outcomes and cursor atomically, retaining immutable canonical prefixes and refusing journal-ID business-content collisions. Cursor-ahead, missing changes or generation changes pause for recovery; no cursor is silently discarded.

Operational reporting projects accepted canonical journals plus only this device's pending/sending or accepted-awaiting-download journals. It deduplicates IDs, excludes known exceptions and device-only compensation, flags orphaned/duplicate pending reversals, and uses the shared domain reports. Canonical-only reports label their cursor. Device-history reports retain originals and may omit other devices' work, especially after joining or restoring an older backup. Neither report projection rewrites either history.

Cloud drafts persist in the canonical snapshot. This phase's desktop edits/posts its own source drafts; editing another device's draft is not provided. Conflicting draft versions remain explicit rather than merged.

## Exception resolution

Unknown outcomes must be reconciled before compensation. A durable rejected/conflicting journal can be offset on this device with a reasoned full linked reversal in an open period; it is marked device-only atomically with the resolution link. If an exact full reversal already exists and both commands have durable exceptions, it can be explicitly designated instead of posted twice. Accepted cloud journals use ordinary synchronized reversals.

A failed reversal cannot itself be reversed under the domain model. Its device compensation is a reasoned general contra journal with exactly opposite lines, linked through resolution metadata and excluded from cloud delivery. A reviewed replacement is a new journal with current dates/versions and a rejected-root link. PostgreSQL permits at most one accepted replacement per root. Original failures, compensations, replacement attempts and reasons remain visible/resumable. No financial payload or date is silently changed.

## Backup and recovery

Local encrypted backups preserve source records, outbox, canonical mirror, cursors and public grants; no bearer token is backed up. Restore validates/migrates a separate candidate, rotates vault generation before atomic replacement, clears leases and pauses synchronized posting. Explicit online recovery checks the enrolled account/device, reconciles durable receipt batches and a full authorized snapshot, then issues a grant for the new generation.

Previously accepted source receipts and canonical immutable prefixes must still exist. A server snapshot missing accepted evidence is refused with history conflict; local evidence is preserved for an accountant/operator to reconstruct the authoritative history. An older backup may omit newer accepted work: the canonical mirror recovers it without rewriting the older local source journal.

After restoring PostgreSQL, stop the API, preserve recovery evidence and rotate all company epochs with the privileged [recovery tool](../../tools/cloud-restore-epoch.mjs) before serving again. It does not repair lost postings. Keep the original signing key; key loss/rotation requires a separately reviewed re-enrollment/migration procedure. Production backup schedules, PITR, RPO/RTO and clean-environment restoration remain Phase 9 operational gates.

## Browser coordination

The browser uses the same typed commands, exact engine, server acceptance, report projection and explicit recovery/compensation rules. Requests go only to `/api/accounting` on its own origin. The server-only proxy pins one configured service origin, forwards only explicit bearer/JSON headers, bounds messages/timeouts, blocks redirects/bootstrap, rejects foreign Origin headers and sets no-store. It forwards no cookies. Cloud bearer sessions live in per-tab memory, clear on lock/sign-out/reload and are never persisted, cached or broadcast. Public signed grants are verified with Web Crypto Ed25519 and pinned against the enrolled account/device/source/generation/epoch; maximum offline authorization remains 24 hours.

IndexedDB transactions plan/apply work; HTTP and signature verification run outside them. Per-company and delivery leases last 60 seconds, with 100-command/100-batch invocation limits, ordered receipt delivery, bounded exponential retry plus small browser jitter, and a 300-second Retry-After cap. Foreground sync reuses the existing visible-tab 30-second check. Reload can resume original command IDs, including discovering an acknowledgment through incremental pull before retry. A lease from a crashed tab expires; it is never treated as acceptance.

BroadcastChannel sends only lock/account-change/book-change notifications, never credentials or financial payloads. Explicit lock propagates across tabs. A cloud account change clears other tabs' live cloud sessions conservatively; another unlocked tab may still use its valid stored grant for allowed offline work until expiry/revocation is learned. Restores rotate durable generation so a stale tab cannot write even if a notification is missed. Responses are applied only after rechecking the current tab's cloud session nonce, device, generation and lease; shared UI refreshes also guard selected-company/account context.

Canonical snapshots/outcomes/cursors and compatible masters apply together, preserving immutable accepted prefixes. A known device/epoch/permission rejection pauses affected authority with its durable outcome; a browser permission rejection conservatively requires online renewal. The native adapter preserves a renewed read-only grant when an older queued action is denied, and pauses if a previously granted permission or device is withdrawn. Local-only companies remain independent. Restored or conflicting history requires explicit recovery, not silent cursor reset.

Lost enrollment acknowledgments retry their frozen seed/import identity. The service now pairs the original import receipt with the **current** epoch/cursor/canonical snapshot and renewed grant, so other-device changes or an epoch rotation do not produce an inconsistent old snapshot/fresh grant response. Newer browser source commands queue separately. Browser/Windows backups are host-specific; shared cloud companies, not cross-format restore, provide interoperability.
