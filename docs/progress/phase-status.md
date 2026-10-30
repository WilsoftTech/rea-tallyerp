# Phase progress and evidence

Date: **2026-10-30** (Africa/Nairobi, client context). Active authorization: **Phase 6 only**. **Phase 1 progress: 100% (10/10 mandatory criteria).** **Phase 2 progress: 100% (6/6 mandatory criteria).** **Phase 3 progress: 100% (6/6 mandatory criteria).** **Phase 4 progress: 100% (6/6 mandatory criteria).** Phases 1–4 are **APPROVED AND CLOSED**. Phase 4 closure approval: **granted** by “close and proceed to next phase”. **Phase 5 progress: 100% (6/6 mandatory criteria).** Phase 5 closure approval: **granted** by “approved” (2026-10-30, after “proceed to next phase”). Phases 1–5 are **APPROVED AND CLOSED**. **Phase 6 progress: 0% (0/5 mandatory criteria).** Phase 6 closure approval: **not granted**. Phase 7 blocked. The owner explicitly requested the 2026-10-30 commit/push (a2afcda); no further commit/push/deployment is authorized.

## Phase 6 current milestone

Phase 6 authorized 2026-10-30. Rules, roadmap, Git state and prior gates were read. Phases 1–5 are closed and the Phase 5 evidence is final.

Reuse inventory: the shared domain (journals, reversals, money/rounding, periods), the AccountingService command/receipt/audit path, validateCommit/replayCommit, ClientBookStore CAS, native validation.rs/cloud.rs, the contracts codec, IndexedDB/SQLite hosts, the cloud API and the shared React workspace. There was no existing party, invoice, allocation or numbering code.

Research: REA was not connected this session, so Tally sales/receipt/return/allocation UI is **NOT VERIFIED**. Attributed vendor documentation and the independent design decisions are in [research](../research/tally-workflows.md#phase-6-salespurchase-reference-research-2026-10-30). No walkthrough is required.

Plan: (1) domain/application trade engine; (2) wire contracts/codec and Rust native validation of the new commands; (3) IndexedDB/SQLite hosts plus cloud API/Prisma persistence, with accepted numbering assigned by the service; (4) shared desktop/web forms and reports; (5) full browser/native/cloud conflict, permission and reconciliation gates, then docs.

Step 1 milestone: implemented [trade.ts](../../packages/domain/src/trade.ts) and the save-party/post-document/allocate/void-document commands, with commit invariants (document immutability except voiding, append-only allocations, no party removal, control-ledger reservation, document/journal links). Verified: [trade.test.ts](../../packages/application/test/trade.test.ts) 13/13; package suites 122/122; typecheck and lint pass. This is engine-level evidence only. No criterion passes until the hosts, cloud, UI and full gates are done, so progress stays 0/5. The desktop vault (Rust) and the cloud do not accept the new commands yet.

## Phase 5 milestone record

Read engineering rules, roadmap, all six prior exit criteria/evidence and dirty Git state. Preserve all prior uncommitted Phase 3/4 work and owner data/services. Reviewed reuse: domain/application/validation, protocol/codec/report projection, original React forms/workspace/CAS adapter, native/API test fixtures and Vite/Playwright. No browser app existed at phase start.

REA 6.8.0 responds, no target/cleanup active; Windows UI observation remains unsupported. Installed C:/Tally.ERP9/tally.exe remains version 1.0.4.93, 7,198,096 bytes, SHA-256 be0ba3120ae514d485a059d5cf07018dd8a67ebcd289dd6e66bd113db6581c54. Reused matching retained metadata; no launch, decompilation, production data or traffic capture.

Original plan: shared host-neutral UI/CAS extraction; Next.js public client shell and fixed-origin same-origin API proxy; real IndexedDB atomic commits/outbox/migrations with cross-tab generation checks; memory-only cloud bearer sessions and the existing maximum 24-hour signed grants; shell-only caching with deliberate worker updates; browser storage/quota/eviction status and encrypted external backup/restore. Research and dependency admission were recorded before installation. All six criteria were held open until real browser/database/native integration, build/type/lint/audits and documentation passed (2026-10-30).

Implementation milestone: added Next.js 16.4.3 only; extracted the existing UI/styles/CAS adapter and reused the actual service/domain/contracts. Implemented IndexedDB v2/strict transaction acknowledgment, trusted-principal replay, durable sync intents/leases/grants/canonical mirror, native-Web-Crypto credential/ERPWEB01 external backups, fixed-origin proxy and public-shell worker. Nine browser/cloud checks passed (real PostgreSQL/native reconciliation, unknown acknowledgments, fresh epoch enrollment retry, conflict/compensation/recovery, account-change, Chrome/Firefox/Edge signed grants, expiry/tamper and after-renewal device revocation). Actual Chromium quota rollback passed after applying its test limit before first writes; migration/blocked/newer schema and controlled site-data loss passed separately. Full regression, production UI/update/download checks, crash fixture, audits and documentation were completed in the 2026-10-30 verification run below.

Verification run 2026-10-30 (local build host): typecheck, lint, full build (API/desktop/web; public shell 27 paths) and foundation validation passed. With npm run db:start, native:harness and desktop:debug (one LNK1109 temp-file lock, passed on rebuild), the full Vitest run passed **182/182** across 12 files, including real PostgreSQL/API, native SQLite, Chrome/Firefox/Edge browser, quota, renderer-crash, upgrade, sync/conflict and encrypted-backup cases. Native Rust **8/8**, Clippy (-D warnings) and rustfmt passed. npm audit: **0** vulnerabilities (379 dependencies). The first full run failed 1/182: the service-worker update test reopened a tab immediately after closing the old ones, racing worker hand-over (old cache retained, or a stalled navigation); 1 of 3 isolated reruns passed. The test now observes activation from the worker context with zero tabs open before reopening; it then passed 5/5 isolated runs, the full 182/182 run, and 3/3 whole-file runs after a type-only follow-up. Worker code was unchanged. Native OSV audit: 525 crates, 292 Windows packages, **1 Windows finding** — GHSA-qwgh-2vcv-g2f7 in block-buffer 0.10.4 (fixed only in 0.12.x) via digest 0.10 from argon2 0.5.3 (runtime vault KDF) and tauri-codegen (build-time). It is not yet resolved or accepted; it awaits an owner decision because removal requires an argon2 major upgrade affecting vault key derivation. On 2026-10-30 the owner chose to accept this advisory and defer it to Phase 9 (security); it is recorded as accepted, not resolved. The criterion review is complete; see the report below.

Integration fixes under Phase 5: enrollment retries return the original import identity with a current canonical frame/grant; source ledger/group forms send scope fields without extra principal fields; browser and native delivery handlers persist revocation pauses with known rejection outcomes. Native retains already-renewed read-only grants for queued permission denials. Existing owner desktop development processes/data are preserved; a separate `.cache/native-phase5` target builds the embedded test executable. Earlier test-harness issues (wrong Firefox cache, overly broad file watching, delayed browser actions and async worker polling) are being corrected, not counted as passes or missing reference observations.

## Phase 5 completion report

[Machine-readable evidence](../testing/phase5-evidence.json) records per-file test counts, all 32 browser cases, commands, advisories, the accepted risk, reviews and limitations.

| ID | Result | Proof |
| --- | --- | --- |
| P5-01 | PASS | Browser host reuses the shared workspace UI, ClientBookStore CAS adapter, AccountingService and contracts; static `/` reopens offline and posts in Chrome, Firefox and Edge |
| P5-02 | PASS | Strict IndexedDB commits with outbox; cross-tab CAS and restart; v1→v2, blocked and newer-schema upgrades; company isolation; inverted period shows a focused, described, aria-invalid error, blocks creation and is rejected at the commit boundary |
| P5-03 | PASS | Cache Storage contains only public shell paths, never company content; waiting update keeps unsynchronized work and activates only after all old tabs close; account change and delayed login cannot install stale authority |
| P5-04 | PASS | Browser posting reconciles with the native desktop through real PostgreSQL; lost acknowledgments, enrollment retry, period conflict/compensation, signed grants, revocation and viewer scope |
| P5-05 | PASS | Real Chromium quota exhaustion aborts atomically; renderer crash, blocked upgrade, site-data loss and private-context closure give explicit outcomes; persistence request/denial and encrypted ERPWEB01 download/restore |
| P5-06 | PASS | Checks below; npm advisories 0; native advisory owner-accepted/deferred; supported and unsupported modes declared in [security](../architecture/security.md); accounting, storage, security and reference reviews in the evidence |

Verification: full Vitest **182 passed, 0 failed, 0 skipped** (12 files); Rust **8/8**; typecheck, lint, build, Clippy, rustfmt and foundation validation passed. Infrastructure: owned loopback PostgreSQL started for tests and **stopped** afterwards; the standard native debug target was rebuilt with no owner desktop process running.

Issues: the service-worker update test race is fixed in the test only (details above). The accepted advisory GHSA-qwgh-2vcv-g2f7 (block-buffer 0.10.4 via argon2 0.5.3 and tauri-codegen) stays open for Phase 9; whether its panic path is reachable from argon2 is not test-proven. Limitations: IndexedDB is plaintext best-effort storage; only current Windows Chrome/Edge/Firefox on HTTPS or loopback are supported; immediately reopened tabs can be served by the previous worker until hand-over; offline grants last at most 24 hours; no public hosting, large-dataset performance, human screen-reader trial or signed installer.

Git: the Phase 3–5 working tree was committed and pushed as **a2afcda** on the owner's explicit request. Changes since then are uncommitted: apps/web/test/shell.test.ts, this record, the Phase 5 evidence, ROADMAP.md, README.md, the documentation index, the test strategy and the security document. Proposed commit summary: **test(web): verify Phase 5 offline browser host and record completion evidence**.

**APPROVED AND CLOSED — 2026-10-30.** The owner approved this report (“approved”, following “proceed to next phase”), authorizing Phase 6 only.

## Phase 4 historical completion report

The following is the technical completion snapshot. Its then-pending approval is superseded by the owner's explicit closure/Phase 5 authorization above. Its executed tests remain historical evidence, not newly executed Phase 5 checks.

### Historical Phase 4 status at technical completion

Date: **2026-10-26** (latest client date, Africa/Nairobi). Active authorization: **Phase 4 only**. **Phase 1 progress: 100% (10/10 mandatory criteria).** **Phase 2 progress: 100% (6/6 mandatory criteria).** **Phase 3 progress: 100% (6/6 mandatory criteria).** Phases 1–3 are **APPROVED AND CLOSED**; Phase 3 closure approval: **granted** by “Implement phase 4”. **Phase 4 progress: 100% (6/6 mandatory criteria).** Phase 4 closure approval: **not granted**. Implementation **COMPLETE**; verification **COMPLETE**; **AWAITING USER APPROVAL**. Phase 5 remains blocked; no commit/push/deployment is authorized.

## Phase 4 implementation and evidence

[Machine-readable evidence](../testing/phase4-evidence.json) records actual test counts/cases, build identity, advisory scope, limits and the complete changed-file list. Raw test timestamps retain the execution clock; this report uses the latest client date.

The approved plan was completed using the existing shared accounting engine, application ports, Vite/React desktop, SQLite adapter, controls, errors and tests. Supported read-only REA responded before design; Windows UI remains unsupported. Official ERP9 synchronization/security/recovery sources were recorded as vendor documentation, with installed behavior **NOT VERIFIED**. No new Tally launch, extraction, production traffic/data or manual walkthrough was needed.

Implemented: Node HTTP/HTTPS API with scrypt/opaque sessions, organization/company roles and assignments; Prisma/PostgreSQL with a non-owner RLS role, immutable journal/outcome/audit constraints and atomic cursor allocation; strict protocol-1 contracts; reviewed idempotent enrollment, safe cancellation and multi-device joining; native-memory bearer handling and signed **24-hour** device-bound offline grants; SQLite v1→v2 durable outbox/leases/backoff; online shared masters; separate canonical mirror and original source history; visible delivery states and report bases; explicit original/reversal compensation, designation and one accepted replacement per root; encrypted-backup generation/receipt recovery; stopped-service server-epoch tool.

Source financial postings remain immutable. Rejected work is never erased or silently dated differently. Unknown acknowledgments retry the original command. Operational reports deduplicate accepted journals and include eligible device-pending work while excluding durable exceptions and device-only compensation. Local-only companies stay independent of cloud permission expiry.

## Phase 4 verification record

| Check | Actual result |
| --- | --- |
| Full Vitest run | **146 passed, 0 failed, 0 skipped**, six files: 103 core + 12 real native SQLite + 3 shared contract + 28 real PostgreSQL/API/native/UI cases |
| Native Rust | **8 passed, 0 failed/ignored**, including v1→v2 interrupted migration, signed-grant tamper/expiry/clock/key checks and origin restrictions |
| Real Windows WebView2 | **8 checks passed** inside the API suite: accessible range rejection, offline accounting/year/restart, IPC restriction, login/reviewed import, pending→accepted reconciliation and sign-out |
| Type/lint | npm run typecheck and lint passed; native Clippy (-D warnings) and rustfmt check passed |
| Builds | Shared/contracts/API emission, Prisma generation, static desktop, native harness and debug/release Windows executable passed |
| Emitted runtime | Built-package accounting smoke and actual emitted API startup/health with the non-owner PostgreSQL role passed |
| Database/concurrency | 12-request duplicate race, changed payload refusal, deferred SQL balancing/range/immutability, injected persistence rollback, period-close/post and chart races, six-request recovery race, actual viewer RLS and device withdrawal checks passed |
| Recovery/conflicts | Lost acknowledgment plus process restart; role downgrade/device withdrawal; old-backup generation reconciliation; missing accepted history refusal; original/reversal compensation; existing reversal designation; enrollment collision/cancellation tombstone; real stopped-service epoch rotation passed |
| Advisories | npm: zero known vulnerabilities. OSV: 525 locked crates queried, 292 Windows graph packages, zero Windows findings; six records for five non-Windows versions retained, not concealed |
| Repository/docs | Foundation file/link/evidence/phase-gate validation and Git whitespace checks passed; final report and all affected docs updated |

Actual commands are retained in the evidence. Full tests require npm run db:start, build, native:harness and desktop:debug; unavailable infrastructure fails rather than skips. Helpers use only isolated synthetic stores and a checked random PostgreSQL fixture database. No owner AppData or existing user company was migrated/reset by tests.

Final executable: **9,394,176 bytes**, SHA-256 **390ba9db71d8e4cc9a22309b091bab44cf1cecbd0e4c3029ef7c87498182da9e**. Frontend: **277,229 bytes**, Node-default gzip **84,564 bytes**. No Node server is bundled. Latest synthetic debug sample: startup **2879 ms**, navigation **138 ms**, **175,464,448 bytes** private working set across **7** owned native/WebView processes. These are host samples, not low-end/release-scale guarantees; earlier runs varied.

The temporary API/native/UI processes are closed. The owned loopback PostgreSQL development cluster is **stopped**, with files/credentials preserved; restart with npm run db:start. No public hosting or default interactive account was created. The first owner still requires the protected bootstrap operation described in the root README/database document.

## Dependency and audit decisions

Added only active-phase dependencies: Prisma/client/adapter-pg **7.10.1**, pg/@types **8.23.1**, Zod **4.6.7**, native reqwest **0.13.5** with Windows TLS, ed25519-dalek **3.0.0** and base64 **0.23.1**. Native HTTP/crypto/scrypt, standard file locks, existing React/Vite/SQLite and test tools cover the rest; no framework/queue/provider/UI catalog was added. The domain has no runtime dependencies.

No PostgreSQL/container runtime existed. Official PostgreSQL **18.6** portable archive identity was verified again: 384,620,317 bytes, SHA-256 E2246BA91D22345BC3D017586C09EDE52D9DF180B1EEB480F050445F1CAD84E2. postgres.exe is NotSigned; this is a local HTTPS-download identity record, not an independently verified vendor signature. Only bin/lib/share were extracted under ignored cache; no Windows service or external host was provisioned. Development credentials/signing key are ignored and excluded from source. A workspace Prisma schema-engine helper resolved the earlier Roaming-cache restriction.

Review fixes are recorded rather than hidden: the initial bundled TLS backend failed to compile and was replaced by Windows native-tls; a PostgreSQL setup connection timeout was bounded and rerun successfully; the recovery operator's audit FK was fixed using a disabled system principal/database-role audit; an ineffective WebView IPC interception was replaced by real shared native-boundary response-field assertions; consistent tenant/membership and exclusive device-recovery lock order resolved an audit finding. Final tests listed above pass; no failed or skipped mandatory implementation check is hidden.

## Scope limits and remaining issues

No unresolved release-blocking defect remains within this phase. All six mandatory criteria are satisfied; the remaining limits belong to the explicitly later release/assurance gates. SQLite remains plaintext with one local vault owner; offline grants do not defeat a malicious OS clock/admin or provide instant disconnected revocation. Snapshot/request/response/backup bounds and full as-of snapshots remain small-book limits. Cross-device editing of another device's source draft is not supplied. Non-Windows dependencies have disclosed advisories and Linux is unsupported. Public TLS/hosting, production key rotation, encrypted PostgreSQL backup/PITR/RPO/RTO drills, large-dataset performance, human screen-reader trials and signed clean-machine installation remain later gates. Missing accepted cloud history deliberately stops for operator/accountant reconstruction.

## Git and documentation

Branch **main**, base commit **c37ff6127546e50b06a9810e98f3400c4a29515b**. Existing uncommitted Phase 3 work is preserved alongside Phase 4; no new commit, push, history rewrite or deployment occurred. The evidence contains **96 changed paths**, including preserved Phase 3 files; this is not represented as a Phase 4-only Git diff.

Primary Phase 4 changes: apps/api (service, schema/migrations and tests); packages/contracts; shared typed receipts/history validation; desktop native cloud/grant/transport/sync/storage/recovery and frontend synchronization/report controls; cloud/Prisma/native/API-check tools; root manifests, lockfiles, line-ending rules, scripts and foundation checks. The full filename list is in phase4-evidence.json.

Proposed commit summary for later authorization: **feat(sync): add scoped PostgreSQL authority and durable native synchronization**. Review/staging must acknowledge the preserved uncommitted Phase 3 foundation; no commit has been prepared by silently changing its history.

Updated: AGENTS.md, CLAUDE.md, ROADMAP.md, root README, documentation index/redirect, architecture overview/decisions/database/sync/security, accounting integration, reference research, test strategy, this progress record and Phase 4 evidence.

## PHASE COMPLETION REPORT

- Phase: **4 — Cloud Backend and Synchronization**
- Completion percentage: **100% (6/6 mandatory criteria)**
- Implementation status: **COMPLETE; verification COMPLETE; AWAITING USER APPROVAL**
- Features implemented: authenticated scoped backend, reviewed enrollment/join/cancellation, signed offline authority, durable native sync/canonical reports, explicit exception/recovery workflows
- Components reused: shared accounting/application/commit guards, desktop controls/store, Vite/React/SQLite and existing test tooling
- Dependencies added and justification: only the database/protocol/native HTTPS/signature requirements listed above; no added domain runtime dependency
- Tests passed: **146 Vitest, 8 Rust, 8 WebView2 checks**; type/lint/native/static/runtime checks
- Tests failed or skipped: **none in the final executed mandatory suites**; resolved development failures recorded above
- Build status: shared/API/frontend/harness/debug/release Windows builds **PASS**
- Security review: scoped auth/RLS/native-grant/IPC/backup controls reviewed/tested; zero Windows/npm advisory matches, disclosed non-Windows findings and OS/production limits
- Accounting integrity review: exact amounts, atomic balanced posting/rollback/idempotency/locks, immutable dual histories, explicit linked correction and reconciled source/cloud totals **PASS**
- Documentation updated: listed above; repository/documentation gate **PASS**
- Git changes: 96 changed paths listed in evidence; existing Phase 3 work preserved; no commit/push
- Outstanding issues: disclosed later-phase limits; no unresolved Phase 4 blocking defect
- Exit-gate verdict: **PASS — 6/6 mandatory criteria**
- User approval status: **NOT GRANTED; Phase 5 blocked**

Next permitted action: owner review/approval only. Passing checks cannot approve Phase 5.

**AWAITING USER APPROVAL — NEXT PHASE BLOCKED**

## Phase 3 historical completion report

The following is the Phase 3 report/evidence at its completion. Its then-pending approval is superseded by the explicit Phase 4 authorization above. Phase 3 has now been approved/closed; no prior passing check is promoted to Phase 4 evidence.

### Historical Phase 3 status at technical completion

Date: 2026-10-25 (Africa/Nairobi). Active authorization: **Phase 3 only**. **Phase 1 progress: 100% (10/10 mandatory criteria).** **Phase 2 progress: 100% (6/6 mandatory criteria).** Phase 2 closure approval: **granted** by “close phase 2 and implement phase 3”; Phases 1–2 are **APPROVED AND CLOSED**. Phase 3 closure approval: **not granted**. **Phase 3 progress: 100% (6/6 mandatory criteria).** Implementation **COMPLETE**; verification **COMPLETE**; **AWAITING USER APPROVAL**. Phase 3 is not approved/closed. Phase 4 remains blocked.

## Approval and milestone history

| Milestone | Recorded outcome |
| --- | --- |
| Phase 1 inventory/foundation | Initially two Markdown files and no application/Git; engineering docs, ten-phase gates, architecture and research lab created. Required foundation checks passed |
| REA/reference identity | REA 6.8.0, read-only PE32+ x64 metadata, version 1.0.4.93, retained SHA-256 evidence. Windows native UI unsupported; no code extraction, debugger, licensing bypass or production company use |
| Owner-reported Phase 1 baseline | Lab paths/no loaded company confirmed; Synthetic Reference Lab created using defaults; FY/books explicitly set to 01-01-2026/no openings; 01–28 February accepted; 28 February→1 February blocked with sound only/no visible message; valid restoration and shutdown/reselection succeeded |
| Reference limitations | Individual defaults and exact reopened FY/books/report dates NOT VERIFIED. Owner reports are not independent runtime captures or proof of field persistence |
| Phase 1 approval | “Implement phase 2” explicitly closed Phase 1 after 10/10 technical completion and authorized Phase 2 |
| Phase 2 research/implementation | Owner redirected ledger/voucher research to official Tally sources, then clarified missing UI observations must not block independently tested standard accounting. Shared original domain/application packages, memory reference adapter, exact money, journals/reversals/drafts/locks/reports implemented |
| Phase 2 technical completion | 103 Vitest tests, type/lint/build, emitted-package smoke, scoped security/accounting review and repository checks passed; 6/6. Memory tests made no disk-durability claim |
| Authorized publication | Earlier owner push request completed at c37ff6127546e50b06a9810e98f3400c4a29515b on main/origin, preserving prior README commits. No force-push or deployment |
| Phase 2 closure / Phase 3 authorization | “close phase 2 and implement phase 3” explicitly approves and closes Phase 2. This authorizes desktop implementation, not a new commit/push/deployment or Phase 4 |
| Phase 3 research before design | REA responded; native UI remains unsupported. Existing owner company/period findings and official backup/report sources recorded separately. No new Tally launch or manual request was needed for a material design ambiguity |
| Phase 3 implementation | Original React/Tauri UI; shared engine/commit guards; durable scoped SQLite and atomic outbox; local-owner sessions; additional financial years; encrypted backup and validated restore |
| Phase 3 verification | 115 Vitest tests, five Rust unit tests, real Windows debug/release builds and five WebView2 flow checks passed. Resources, advisory/platform review and accounting/security review recorded below; final document gate passed |

## Phase 3 implemented behavior and reuse

The desktop in `apps/desktop` embeds static React assets in Tauri without a Node server. Reusable Field/Panel controls use native HTML/CSS; no UI catalog or state framework was installed. Company creation explicitly chooses currency/scale/books/year dates; the original date defaults are editable current-year convenience values, not Tally observations. An audited shared command appends financial years without rewriting existing calendars. Company/year selection, chart/group creation, exact journal/draft posting, full reversals, period lock/reopen, ledger drill-through and trial balance work locally.

The existing TypeScript domain/application engine remains the accounting authority; no React/SQL/native dependency enters the pure domain. Memory commit guards were extracted for reuse in DesktopBookStore. Optimistic revision CAS retries against current state; command IDs survive same-form retries, and lost responses are confirmed only against an exact immutable receipt. Native scope/permission, balanced i64 lines/i128 aggregates, version/lock and immutable-history guards run before persistence.

SQLite schema v1 uses scoped books/config snapshots, period/ledger projections, finalized journals/lines, receipts, audit and not-enrolled outbox. Each command commits every effect or none under BEGIN IMMEDIATE; WAL/FULL/FKs are read back in tests. Native OS file locking surrounds authentication and each operation across processes, including recovery; lock contention is bounded. Restore validates a separate snapshot and rotates vault generation before atomic replacement, revoking all stale sessions. The unreleased v1 schema was finalized during this phase; later deployed changes require forward migrations.

Native local-owner authentication uses salted Argon2id, random in-memory tokens, 15-minute inactivity expiry and two-second failed-unlock delay. No cloud grant/provider, persistent session secret or OS credential-manager integration is claimed. SQLite is unencrypted; the UI discloses reliance on Windows/device protection. Backup format ERPBAK01 uses fixed Argon2id parameters and authenticated AES-256-GCM with random salt/nonce. File selection occurs through native dialogs; no SQL/shell/general filesystem IPC is exposed.

The owner’s REQ-PERIOD-RANGE-01 now has shared domain validation, native/SQLite range rejection, visible inline error/highlight, blocked keyboard submission, focus correction and screen-reader error association. The audible-only Tally finding remains owner-reported reference evidence, not our behavior.

## Verification evidence

Machine-readable record: [Phase 3 evidence](../testing/phase3-evidence.json). These are independent original ERP results, never Tally observations.

| Actual command/check | Final result and limits |
| --- | --- |
| npm.cmd test | PASS — four files, **115 tests**: 103 prior cases plus 12 real native-adapter cases; no skipped/missing-binary fallback |
| npm.cmd run native:test | PASS — **5 Rust tests**: real calendar/canonical amounts, SQLite WAL/FULL/FKs/immutability, interrupted migration rollback/reopen, password/session expiry, invalid backup preservation |
| npm.cmd run typecheck / lint / build | PASS — strict source/tests, ESLint zero warnings, domain/application JS/declarations and original frontend bundle |
| npm.cmd run check:built | PASS — actual emitted Node ESM exports, inverted-range rejection, idempotent scoped posting and exact trial balance |
| npm.cmd run native:harness | PASS — actual Rust/SQLite executable; no simulated DB driver |
| npm.cmd run native:lint / native:fmt | PASS — Clippy all native targets with warnings denied; rustfmt check |
| npm.cmd run desktop:debug | PASS — actual Windows executable embeds frontend assets for isolated UI tests |
| npm.cmd run desktop:build | PASS — optimized Windows executable, no installer/publication/deployment; **7,922,688 bytes**. SHA-256 in evidence |
| npm.cmd run test:desktop | PASS — five checks in the actual isolated WebView2: invalid-range Enter submission/inline text/ARIA/focus; keyboard journal posting and exact reports with external HTTP blocked; second FY creation/selection; unregistered SQL command denial; forced process exit/restart/unlock retains records |
| Native-adapter accounting/recovery | PASS — two-process duplicate CAS races, two valid companies, full reversal/locks, forged mutations rejected atomically, financial-year append/idempotency/overlap/permission, lost-ack receipt confirmation, int64-max line readback and wider report totals, process death in uncommitted write, forced SQLite disk-full, encrypted snapshot/wrong-key/tamper/restore and stale second-process session invalidation |
| npm.cmd audit --json | PASS — zero known npm advisory findings. One report parsing attempt read PowerShell UTF-16 as UTF-8; corrected parsing confirmed actual audit result |
| npm.cmd run audit:native | PASS for Windows scope — 500 locked published crates queried through OSV; locked offline cargo tree has 252 normal/build graph nodes including our app, no advisory matches. Six records for five non-Windows crate versions are retained, not suppressed |
| npm.cmd run check:foundation / git diff --check | PASS — 19 required foundation files, 72 local Markdown targets, 83 source text files and two binary icons; computed phase/status gates agree. git diff --check passed. Repository validation is not a build/accounting substitute |
| Signing/installer, browser/cloud, human screen-reader trial | NOT RUN / outside Phase 3. No claim that ARIA automation equals a human assistive-technology trial or that a built EXE is an installer |

Resource baseline on this host: latest debug spawn-to-visible/CDP probe **3060 ms**; previous debug runs 5,644–6,297 ms. Latest second navigation **163 ms**. Private working set across **7 owned native/WebView2 processes: 99,184,640 bytes** (~95 MiB). These warm host/debug observations are not a controlled cold-start or release SLA. Twenty real 20-line postings on a book growing to 400 lines measured p50 **39 ms**, p95 **70 ms**, max **73 ms**. Frontend JS is ~262.44 kB / 81.38 kB gzip and CSS ~3.07 kB. Agreed low-end hardware, 100,000-line scale and production tuning remain Phase 9 targets.

## Review findings, corrections and limitations

Initial Windows TLS credential restrictions prevented sandbox rustup/Cargo downloads; scoped credential-enabled operations succeeded. Microsoft's official hash-verified C++ workload and workspace-local Rust were necessary for actual Windows builds. Rust formatting/linting tools were added to that local toolchain; global PATH and PowerShell policy were unchanged. Native build required an ICO, generated from our original SVG. The first UI run found error text included in the accessible label; separate label/description markup fixed it and passed. Clippy findings were fixed and rerun. A one-off evidence metadata script had a syntax error and was corrected before recording evidence. No final mandatory failure is concealed.

Security review: main-window-only named IPC, authenticated fixed tenant/local owner, explicit permission lists, CSP, no remote/SQL/shell/path capabilities, bounded payload/backup input, session expiry/restoration generation and lock serialization tested/reviewed. Native file-dialog backup paths are selected by the user; headless test paths are not desktop IPC. Logs/errors do not include credentials/full financial payloads. Backup authentication and restore schema/FK/journal/receipt/audit/outbox reconciliation were verified. This is a scoped engineering review, not certification or protection from an OS administrator.

Accounting review: common exact domain rules, native i64 bindings above JS safe integers, wider balanced sums, immutable original/reversal history, current period/chart versions, company scope, atomic receipt/audit/outbox and restart reconciliation passed. Calendar extension preserves existing posted-year/period definitions. No last-write-wins financial merge or fictitious cloud acknowledgment exists.

Outstanding limitations (not hidden defects): one local owner; unencrypted SQLite and temporary snapshots; unrecoverable backup passphrase/historical device-password loss; full-copy/full-book validation plus 16 MiB command/128 MiB backup limits; small-book/debug resource samples; no installer/signature or independent security assessment. OSV records for glib 0.18.5 (two aliases), proc-macro-error 1.0.4, zbus_names 4.3.5, zvariant/zvariant_derive 5.15.1 are outside the verified Windows graph; resolve before supporting those targets. Tally local offline posting/reports/recovery remain NOT VERIFIED, separately from our tests. No cloud/browser, tax, invoice, inventory or compliance behavior is claimed.

## Dependencies and change management

React/react-dom 19.3.1, Tauri API/CLI 2.12.4, React types 19.3.0 and Playwright 1.64.1 were added only for this desktop phase; Vite 8.3.5 reused. Native Cargo.lock pins Tauri 2.12.5, rusqlite 0.41.0/bundled SQLite, serde, rfd, Argon2/AES-GCM/getrandom, zeroize and tempfile. These supply native persistence/dialogs, serialization and maintained cryptography rather than raw renderer access or custom primitives. No frontend SQL driver, full component catalog, browser download or Node server. Exact rationale/licenses/tooling footprint are in [decisions](../architecture/decisions.md).

Base is the previously published c37ff6127546e50b06a9810e98f3400c4a29515b. This phase remains uncommitted/unpushed. Proposed commit summary: **feat: add offline Windows accounting desktop and durable SQLite recovery**. Generated builds/dependencies/cache, local/reference stores, encrypted backups and credentials are ignored. No history rewrite or deployment.

Changed-file inventory (60 files; includes this report and independent evidence):

- .gitignore
- AGENTS.md
- CLAUDE.md
- README.md
- ROADMAP.md
- apps/desktop/index.html
- apps/desktop/package.json
- apps/desktop/src-tauri/Cargo.lock
- apps/desktop/src-tauri/Cargo.toml
- apps/desktop/src-tauri/build.rs
- apps/desktop/src-tauri/capabilities/main.json
- apps/desktop/src-tauri/icons/32x32.png
- apps/desktop/src-tauri/icons/icon.ico
- apps/desktop/src-tauri/icons/source.svg
- apps/desktop/src-tauri/migrations/001.sql
- apps/desktop/src-tauri/permissions/autogenerated/accounting.toml
- apps/desktop/src-tauri/src/harness.rs
- apps/desktop/src-tauri/src/lib.rs
- apps/desktop/src-tauri/src/main.rs
- apps/desktop/src-tauri/src/recovery.rs
- apps/desktop/src-tauri/src/storage.rs
- apps/desktop/src-tauri/src/tests.rs
- apps/desktop/src-tauri/src/validation.rs
- apps/desktop/src-tauri/tauri.conf.json
- apps/desktop/src/env.d.ts
- apps/desktop/src/main.tsx
- apps/desktop/src/native.ts
- apps/desktop/src/store.ts
- apps/desktop/src/style.css
- apps/desktop/src/workspace.tsx
- apps/desktop/test/storage.test.ts
- apps/desktop/tsconfig.json
- apps/desktop/vite.config.ts
- docs/README.md
- docs/accounting/accounting-engine.md
- docs/architecture/database.md
- docs/architecture/decisions.md
- docs/architecture/offline-sync.md
- docs/architecture/overview.md
- docs/architecture/security.md
- docs/progress/phase-status.md
- docs/research/tally-workflows.md
- docs/roadmap.md
- docs/testing/phase3-evidence.json
- docs/testing/test-strategy.md
- eslint.config.mjs
- package-lock.json
- package.json
- packages/application/src/commit.ts
- packages/application/src/contracts.ts
- packages/application/src/index.ts
- packages/application/src/memory-store.ts
- packages/application/src/service.ts
- tools/audit-native.mjs
- tools/check-foundation.mjs
- tools/desktop-e2e.mjs
- tools/icon.mjs
- tools/native.mjs
- tsconfig.json
- vitest.config.ts

## PHASE COMPLETION REPORT

| Field | Result |
| --- | --- |
| Phase | 3 — Offline Desktop Application |
| Completion percentage | **100% — 6/6 mandatory criteria** |
| Implementation status | **COMPLETE**; verification **COMPLETE**; awaiting approval |
| Features implemented | Original desktop/company/year/chart/entry/draft/reversal/lock/report workflows, durable SQLite/atomic outbox, local sessions, encrypted backup/validated restore |
| Components reused | Shared domain/application rules, extracted commit validation, existing Vite/Vitest, native HTML controls/standard file locks |
| Dependencies added and justification | React/Tauri/native SQLite, vetted crypto/serialization/dialogs and actual UI/native test tooling; exact admission above |
| Tests passed | 115 Vitest, five Rust unit cases, five WebView2 checks, type/lint/build/built smoke, native lint/format and scoped dependency audits |
| Tests failed or skipped | No final mandatory code/native failure; initial issues corrected above. Installer/cloud/browser and human assistive-technology checks remain outside this phase |
| Build status | PASS — real Windows debug/release, frontend and shared packages; no installer |
| Security review | Scoped host/IPC/auth/restore/backup review passed; plaintext DB and non-Windows advisory limitations disclosed |
| Accounting integrity review | Exact scoped immutable/idempotent posting, reversals, lock/CAS/atomicity/recovery and native wide-money readback passed |
| Documentation updated | Engineering/roadmap/index/status/research, architecture/database/sync/security/accounting/testing and evidence |
| Git changes | 60 files listed above; proposed commit prepared as a summary only; no commit/push/deploy |
| Outstanding issues | No unresolved Phase 3 release-blocking defect identified. Runtime/scale/platform limitations above remain explicit |
| Exit-gate verdict | **TECHNICALLY COMPLETE — AWAITING USER APPROVAL**; Phase 4 blocked |
| User approval status | **NOT GRANTED** for Phase 3 closure or Phase 4 |

**AWAITING USER APPROVAL — NEXT PHASE BLOCKED**
