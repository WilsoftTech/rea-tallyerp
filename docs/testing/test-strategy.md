# Verification strategy

Current state: Phase 2 TypeScript domain/application code and an in-memory reference adapter, with **103 passing Vitest tests across three files**. Real build, type checking, ESLint and a compiled Node ESM integration smoke check pass. No UI/E2E, real DB, disk crash recovery, authentication, sync or installer test has run; those runtimes do not exist. Future plans below are not current results.

## Phase 2 actual checks

Commands: `npm.cmd run build` emits JS/declarations for both workspace packages; `npm.cmd run typecheck` checks source/tests; `npm.cmd run lint` enforces TS rules and forbids framework/native/DB imports in packages; `npm.cmd test` runs Vitest; `npm.cmd run check:built` loads emitted workspace exports under Node with no test aliases; `npm.cmd run check:foundation` validates documents, private/runtime dependency boundaries and phase approval/progress. Node syntax checks apply to the MJS tooling. npm audit reported zero known vulnerabilities.

Coverage includes integer bounds/round trips above JS safe integer and explicit rounding; calendar/leap/range checks; scope/hierarchy/overlap validation; balanced immutable posting/opening/reversals; payment/receipt/transfer; independent J1–J5 balances; wide report totals; locked/stale periods, drafts and chart revisions; trusted-principal permissions; duplicate/colliding/racing commands; caller mutation; append-only persistence-port guards; failed commit rollback. The exact owner-reported inverted period fails in domain and memory registration/commit without publishing invalid state. A compiled-package smoke first rejects a wrong opening date, then verifies a valid idempotent scoped commit and trial balance.

No line/branch coverage percentage is claimed; no coverage plugin added. The memory adapter serializes JS callbacks and validates/copies publication; this does not simulate multi-process database concurrency, power loss, real storage durability or server authorization. Official-source research was used after the owner's explicit redirection; no local ledger/voucher observations are invented.

The owner's research clarification makes synthetic engine fixtures and approved accounting invariants the correctness oracle. Missing Tally UI observations are **NOT VERIFIED**, recorded separately from implementation failures. A fixture's expected/result amount is never promoted to an observed Tally amount. A manual walkthrough is requested only for a specific unresolved behavior that materially changes a design decision; Windows UI limitations alone do not block standard bookkeeping or waive actual engine tests.

## Phase 1 historical verification

Use existing Node/npm/git without installing test frameworks. `node --check tools/check-foundation.mjs` checks script syntax. `npm.cmd run check:foundation` executes required-file, local Markdown target, JSON/evidence, phase-status and foundation-scope validation. It fails for missing documents, inconsistent computed Phase 1 progress, unsupported completion/approval states, or application/dependency scope additions. It skips root `local-data/` and `backups/` so runtime files, binary stores and possible private data are not read as source text. It is a focused repository check, not a full Markdown parser, a secret scanner or application lint/type/build. Synthetic lab preflight is separately recorded; the lab is not a tested application.

Review required docs manually for current-versus-planned claims, accounting/sync/security boundaries, inherited evidence and scope. Use Git status and ignored-file probes. REA Evidence validates connectivity and executable identity; unsupported Windows UI was addressed through the authorized owner-reported manual baseline. P1-10 is satisfied for baseline actions/navigation; exact defaults and retained values remain unverified. Exact actual results belong in [phase status](../progress/phase-status.md).

At Phase 1 completion, type/lint/app build/Vitest/Playwright were not applicable because no application code existed; that historical status does not replace current Phase 2 checks. Manual reference baseline is complete by owner report, not an ERP test. Date-value persistence and individual defaults remain unverified.

REQ-PERIOD-RANGE-01 shared-domain and memory-boundary cases now pass in Phase 2, including structured code/message/endDate and unchanged prior state on failure. SQLite/native desktop inline/highlighted keyboard/screen-reader tests remain Phase 3; API/PostgreSQL enforcement Phase 4; IndexedDB and accessible browser feedback Phase 5. Do not infer UI accessibility from a domain error alone.

## Test layers as implementation arrives

| Layer | Required evidence | Earliest phase |
| --- | --- | --- |
| Pure domain | Hand-worked postings, exact money/overflow/string round trips, invariant and negative cases, period boundaries and reversal rules | 2 |
| Application contracts | Authorization/expected versions, duplicate command behavior, all-or-none posting, deterministic IDs/time; in-memory adapter limitations explicit | 2 |
| SQLite adapter | Real transactions/migrations/constraints, large integer binding, local receipt/outbox atomicity, process kill, disk full and restore | 3 |
| Native boundary/UI | Restricted IPC/capability rejection, keyboard/forms/company selection, offline reopen, Windows build and resource baseline | 3 |
| PostgreSQL/API | Real runtime role/RLS/pooling, cross-tenant reads/writes/exports, concurrent same-ID requests and posting versus lock race | 4 |
| Sync integration | Lost response, duplicate/reordered messages, dependencies, stale/revoked authority, retries, schema incompatibility, cursor gaps and restore generations | 4 |
| Browser | Real IndexedDB transactions, multiple tabs, migrations, quota/eviction recovery, worker updates, first-load limitations, offline navigation | 5 |
| Operations/inventory | Invoice/allocation and stock valuation fixtures; round-trip/correction flows, control ledger reconciliation, conflicts | 6–7 |
| Reporting/compliance | Statements reconcile to fixture ledgers; export precision, as-of/company scope, dated accountant-validated tax cases | 8 |
| Security/reliability/release | Broader attack/concurrency/fault campaigns, encrypted restores/RPO/RTO, realistic scale and clean-machine installer/update/rollback | 9–10 |

Vitest is preferred for shared TS tests; Playwright for browser workflows once browser code exists. Tauri's actual Windows native boundary needs suitable native integration/UI tooling chosen in Phase 3; a mocked web page is not proof of a working desktop installer. No test can substitute for an unavailable native build, database or tax sandbox.

## Fixture and failure principles

- Synthetic fixed-scope data only; no Tally company data, exports or copied layouts. Expected amounts are calculated independently, including the [accounting fixture](../accounting/accounting-engine.md).
- Check balances **and** account selection, uniqueness, scope, immutable history and user-visible acknowledgment state. Balanced entries can still be wrong.
- Exercise crashes before commit, during commit and after commit/before acknowledgment; verify before/after restart using real storage, not only mocked repositories.
- Concurrency tests include simultaneous identical command IDs with same/different payloads, period closure, stale master updates, two tabs/devices and reversals.
- Storage tests use amounts above JS safe integer, boundary dates, empty/large journals, Unicode identifiers/text, failed upgrades and corrupted backup detection.
- Test each adapter with common behavioral contracts; do not duplicate domain calculations in tests or adapters. Separate expected fixtures from implementation helpers.
- Integration reconciliation compares local accepted/pending/exception views and canonical cloud books after retries and corrections; never hide a rejected local posting.

## Phase exit procedure

At each code phase, record exact commands, versions, environment, counts, failures/skips and limitations for tests/type/lint/build. Audit security, accounting and integrations. Record evidence for every acceptance criterion in ROADMAP.md and phase status. An unavailable mandatory environment leaves the gate open and progress below 100%.

Technically complete means every required criterion passed with no release-blocking defect and current docs. At 100%, status becomes **AWAITING APPROVAL**; only explicit owner approval closes the phase and authorizes the next one. Phase 1 is approved/closed. Phase 2 meets six criteria and awaits closure approval; Phase 3 stays blocked. Reference observation gaps and absent runtime infrastructure remain explicitly documented.
