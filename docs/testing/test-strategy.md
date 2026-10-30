# Verification strategy

Current state: Phase 5 verification extends the shared engine, real SQLite/native/PostgreSQL/API/WebView2 checks with actual IndexedDB and production Next.js/service-worker/browser checks. Final Phase 5 verification passed on 2026-10-30 (182 Vitest, 8 Rust); [phase status](../progress/phase-status.md) and [Phase 5 evidence](phase5-evidence.json) record actual results. [Phase 4 evidence](phase4-evidence.json) and [Phase 3 evidence](phase3-evidence.json) remain historical. Tests use synthetic isolated stores/accounts only.

Phase 3 checks: build the native harness (`npm.cmd run native:harness`) before `npm.cmd test`; no missing-binary skip. The integration suite drives the actual Rust SQLite implementation through a separate headless executable, including process exit/reopen, duplicate CAS writers, balanced reversal/locks, forged writes, session denial, disk-full and encrypted backup/tamper/restore. `npm.cmd run native:test` tests SQL guards/settings, interrupted migration rollback and native primitives. This is distinct from memory tests. `npm.cmd run desktop:debug` embeds the frontend and builds Windows WebView2; `npm.cmd run test:desktop` launches that executable with isolated synthetic paths and CDP for keyboard/ARIA/offline-post/report/restart checks. No browser download or Node server is needed by the shipped app. Release Windows build is `npm.cmd run desktop:build`; packaging/signing/install trials remain Phase 10. Native lint/format and JS type/lint/build checks are separate gates. Screen-reader associations can be automated; this is not a claim of a human screen-reader trial.

## Phase 4 checks and prerequisites

Run npm ci, db:start, build, native:harness and desktop:debug before npm test. This host uses the ignored portable PostgreSQL 18.6 cluster. Tests create/drop only a checked random fixture database, apply all forward migrations and query through the actual non-owner Prisma runtime role. A missing cluster, binary or WebView2 fails; no mandatory infrastructure check is silently skipped.

The API integration suite exercises actual HTTP sessions/bootstrap, current membership/company assignments and direct RLS context; duplicate HTTP races; altered IDs; PostgreSQL range/immutable/deferred-balance guards; injected feed failure with full transaction rollback; wide signed-64 money; period-close/post and chart-version races; native enrollment/join; lost acknowledgment plus process restart; role downgrade; rejected original/reversal compensation and replacement; designation of an existing reversal; enrollment collision/cancellation tombstone; cursor/epoch and restored backup reconciliation; refusal of accepted-history loss; and the real stopped-service epoch tool. One case drives the real WebView2 UI against that same isolated service.

Native tests add v1→v2 interrupted migration, Ed25519 tamper/expiry/clock/key cases and origin restrictions to the earlier storage/auth/backup checks. Shared codec tests independently cover import audit completeness, report deduplication/pending/exceptions and identity collisions. Accounting fixture expectations never become Tally observations.

Separate gates: npm run check:api (emitted startup/health against the local cluster); typecheck; lint; build (generates Prisma and emits all shared/API packages plus static desktop assets); native:test; native:lint; native:fmt; desktop:build; check:built; check:foundation. Node syntax checks cover tools. npm audit and audit:native inspect published locked dependency metadata; unsupported-platform findings are retained separately from Windows graph relevance. Production scale, independent penetration testing, public TLS deployment, PostgreSQL PITR and clean-machine signed-installer drills remain later gates.

## Phase 2 actual checks

Commands: `npm.cmd run build` emits JS/declarations for both workspace packages; `npm.cmd run typecheck` checks source/tests; `npm.cmd run lint` enforces TS rules and forbids framework/native/DB imports in packages; `npm.cmd test` runs Vitest; `npm.cmd run check:built` loads emitted workspace exports under Node with no test aliases; `npm.cmd run check:foundation` validates documents, private/runtime dependency boundaries and phase approval/progress. Node syntax checks apply to the MJS tooling. npm audit reported zero known vulnerabilities.

Coverage includes integer bounds/round trips above JS safe integer and explicit rounding; calendar/leap/range checks; scope/hierarchy/overlap validation; balanced immutable posting/opening/reversals; payment/receipt/transfer; independent J1–J5 balances; wide report totals; locked/stale periods, drafts and chart revisions; trusted-principal permissions; duplicate/colliding/racing commands; caller mutation; append-only persistence-port guards; failed commit rollback. The exact owner-reported inverted period fails in domain and memory registration/commit without publishing invalid state. A compiled-package smoke first rejects a wrong opening date, then verifies a valid idempotent scoped commit and trial balance.

No line/branch coverage percentage is claimed; no coverage plugin added. The memory adapter serializes JS callbacks and validates/copies publication; this does not simulate multi-process database concurrency, power loss, real storage durability or server authorization. Official-source research was used after the owner's explicit redirection; no local ledger/voucher observations are invented.

The owner's research clarification makes synthetic engine fixtures and approved accounting invariants the correctness oracle. Missing Tally UI observations are **NOT VERIFIED**, recorded separately from implementation failures. A fixture's expected/result amount is never promoted to an observed Tally amount. A manual walkthrough is requested only for a specific unresolved behavior that materially changes a design decision; Windows UI limitations alone do not block standard bookkeeping or waive actual engine tests.

## Phase 1 historical verification

Use existing Node/npm/git without installing test frameworks. `node --check tools/check-foundation.mjs` checks script syntax. `npm.cmd run check:foundation` executes required-file, local Markdown target, JSON/evidence, phase-status and foundation-scope validation. It fails for missing documents, inconsistent computed Phase 1 progress, unsupported completion/approval states, or application/dependency scope additions. It skips root `local-data/` and `backups/` so runtime files, binary stores and possible private data are not read as source text. It is a focused repository check, not a full Markdown parser, a secret scanner or application lint/type/build. Synthetic lab preflight is separately recorded; the lab is not a tested application.

Review required docs manually for current-versus-planned claims, accounting/sync/security boundaries, inherited evidence and scope. Use Git status and ignored-file probes. REA Evidence validates connectivity and executable identity; unsupported Windows UI was addressed through the authorized owner-reported manual baseline. P1-10 is satisfied for baseline actions/navigation; exact defaults and retained values remain unverified. Exact actual results belong in [phase status](../progress/phase-status.md).

At Phase 1 completion, type/lint/app build/Vitest/Playwright were not applicable because no application code existed; that historical status does not replace current Phase 2 checks. Manual reference baseline is complete by owner report, not an ERP test. Date-value persistence and individual defaults remain unverified.

REQ-PERIOD-RANGE-01 shared-domain and memory-boundary cases pass in Phase 2, including structured code/message/endDate and unchanged prior state on failure. SQLite/native accessible feedback is tested in Phase 3 and API/PostgreSQL range enforcement in Phase 4. Phase 5 implements/tests the actual browser keyboard/inline/ARIA feedback and IndexedDB candidate boundary; current results belong to its evidence. Do not infer UI accessibility from a domain error alone.

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

Technically complete means every required criterion passed with no release-blocking defect and current docs. At 100%, status becomes **AWAITING APPROVAL**; only explicit owner approval closes the phase and authorizes the next one. Phases 1–4 are approved/closed. Phase 5 must meet all six criteria and await closure approval; Phase 6 stays blocked. Reference observation gaps and absent runtime infrastructure remain explicitly documented.

## Phase 5 actual-runtime strategy

Build with `npm.cmd run build`, start the local PostgreSQL cluster, and build the native harness/embedded test executable before the complete `npm.cmd test`. The installed Chrome/Edge and workspace-local Playwright Firefox are required; `node tools/web.mjs browsers` downloads Firefox's pinned test runtime into ignored cache. Tests fail on missing prerequisites. Vitest executes files sequentially to bound browser/database/native contention. No fake IndexedDB implementation, browser storage wrapper or new test framework was added.

`apps/web/test/browser.test.ts` drives the **actual** browser runtime and shared CAS/application/domain through a synthetic Vite-served bridge in Chrome, Firefox and Edge. The bridge is test-only and absent from the production Next shell. Cases cover exact above-safe-integer totals, duplicate/independent tab races, linked reversal, preserved receipts/audit/outbox, scoped companies, direct invalid ranges, transaction rollback, encrypted backup/wrong key/tamper/metadata rejection/restore and stale-tab invalidation. Shared replay cases independently reject balanced result tampering and forged principals.

`storage-failures.test.ts` uses real IDB v1→v2 upgrade fixtures, a deliberately blocking connection, newer-schema refusal, browser strict durability and a renderer crash during an uncommitted write. Actual Chromium quota is set before the fixture's first write (Chromium caches available bucket space); random incompressible bytes provoke QuotaExceededError and verify all-store rollback. Clearing only the synthetic context's IndexedDB models total site-data loss; closing its private context and restoring a downloaded encrypted snapshot checks recovery. Controlled removal is **not** a claim of reproducing discretionary policy-driven eviction or hardware power loss.

`sync.test.ts` uses the same browser code with a real isolated PostgreSQL/API fixture and actual native storage harness. It verifies source/canonical separation, offline exact values, native reconciliation, lost command/enrollment replies, current canonical frame after epoch/other-device advancement, conflict/compensation/backup recovery, delayed account responses, signed 24-hour grant expiry/tampering, viewer/company restrictions and device revocation after grant renewal. Service failures retain original IDs; no expected accounting result is attributed to Tally.

`shell.test.ts` launches the **built production Next server** and actual browser UI. It checks keyboard/ARIA period validation, original ledger/journal/report forms, initial public-shell installation and offline reload/post/report in the supported browsers, storage-persistence denial, a real encrypted downloaded file and file-picker restore, and a controlled worker revision waiting for all old tabs to close before activation. The test-only front proxy changes only the worker revision to exercise the standard lifecycle; it is not a claim of testing every future release migration. Private financial responses never belong in Cache Storage. `proxy.test.ts` exercises the actual Next route against a loopback upstream: explicit bearer only, no cookies, no-store, origin/bootstrap/route/body denial and blocked redirects.

Final checks also include root/host/worker type checking, ESLint, production Next/API/desktop frontend builds, embedded Windows regression, native tests/format/Clippy, emitted-package/API smoke, npm/native advisory review and document/Git checks. An in-use owner executable is preserved by building a separate `CARGO_TARGET_DIR` and setting `ERP_NATIVE_TEST_EXE` for UI tests. Human screen-reader trials, Safari/mobile, installers/signatures, hosted deployment, physical power-loss testing and release-scale performance remain outside these scoped checks.
