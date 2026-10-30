# Master implementation roadmap

Updated: 2026-10-26 (Africa/Nairobi, client date). Active authorization: **Phase 5 only**. Approval history: “Implement phase 2” closed Phase 1/authorized Phase 2; **“close phase 2 and implement phase 3”** now explicitly closes Phase 2 and authorizes Phase 3. The later “Implement phase 4” instruction closes Phase 3 and authorizes Phase 4. The later “close and proceed to next phase” instruction explicitly closes Phase 4 and authorizes Phase 5 only. No later phase, commit/push or deployment is authorized. Original software only; no Tally implementation or distinctive UI is reused.

## Current status

| Phase | Progress | Implementation status | Verification status | Approval status |
| --- | --- | --- | --- | --- |
| 1 — Architecture and Foundation | 100% (10/10) | COMPLETE — foundation and baseline documentation | COMPLETE — foundation checks and owner-reported manual baseline | APPROVED AND CLOSED — 2026-10-25 |
| 2 — Accounting Engine | 100% (6/6) | COMPLETE — shared accounting engine and reference adapter | COMPLETE — 103 tests, type/lint/build, built-package and repository checks | APPROVED AND CLOSED — 2026-10-25 |
| 3 — Offline Desktop Application | 100% (6/6) | COMPLETE — desktop, durable storage and recovery | COMPLETE — native/115 Vitest/5 Rust/5 UI, builds, audits and docs | APPROVED AND CLOSED — 2026-10-25 |
| 4 — Cloud Backend and Synchronization | 100% (6/6) | COMPLETE — scoped backend and native sync | COMPLETE — 146 Vitest/8 Rust/8 UI, real PostgreSQL/native/build/audits/docs | APPROVED AND CLOSED — 2026-10-26 |
| 5 — Offline Web Application | 0% (0/6) | IN PROGRESS — authorized browser scope | Research/design and baseline reuse review | AUTHORIZED — closure not approved |
| 6 — Sales and Purchases | 0% | Not started | Not run | Blocked by Phase 5 |
| 7 — Inventory Management | 0% | Not started | Not run | Blocked by Phase 6 |
| 8 — Reporting and Compliance | 0% | Not started | Not run | Blocked by Phase 7 |
| 9 — Security, Performance, and Reliability | 0% | Not started | Not run | Blocked by Phase 8 |
| 10 — Production Readiness and Release | 0% | Not started | Not run | Blocked by Phase 9 |

Each acceptance row or numbered criterion counts equally within its phase and is all-or-nothing. Future criteria may be refined within approved scope before implementation, with changes recorded. Phases 2–10 include relevant research, tests, lint, type/build checks, security/accounting/integration review and current documentation in their final criterion. Phase 2 uses the owner's explicitly redirected official-source research fallback, attributed separately from local observations. These gates are mandatory. Percentage never implies permission to advance.

Owner's Phase 2 research clarification: use supported read-only REA to inform workflows/UX; mark unavailable Tally UI behavior **NOT VERIFIED**, with no fabricated runtime findings. Build standard accounting logic independently and test synthetic transactions against the approved invariants. Missing reference observations are not implementation defects and do not alone block completion. Ask for a manual walkthrough only when a specific unresolved behavior materially changes a named functional/architectural decision. This policy changes no financial acceptance criterion, grants no new phase approval and does not require another walkthrough for the completed engine.

## Phase 1 — Architecture and Foundation

Scope: workspace inventory, engineering standards, architecture proposals, security/accounting requirements, research setup, documentation and reviewable project boundaries. No business implementation or framework installation.

| ID | Mandatory acceptance criterion | Result / evidence |
| --- | --- | --- |
| P1-01 | Inventory source, tools, existing plans, Git and reuse opportunities | PASS — initial two Markdown files, no source; Git initialized; [status](docs/progress/phase-status.md) |
| P1-02 | Create AGENTS.md and CLAUDE.md with phase, reuse, dependency and originality rules | PASS — root files |
| P1-03 | Create ten-phase roadmap, measurable criteria and approval gates | PASS — this document |
| P1-04 | Establish documentation index, status and truthful current-versus-proposed descriptions | PASS — [index](docs/README.md) and linked documents |
| P1-05 | Propose runtime boundaries, workspace ownership and dependency policy | PASS — [overview](docs/architecture/overview.md), [decisions](docs/architecture/decisions.md) |
| P1-06 | Propose data, money, journal, period and tenant invariants | PASS — [database](docs/architecture/database.md), [accounting](docs/accounting/accounting-engine.md) |
| P1-07 | Propose sync, threat model, backup and recovery requirements | PASS — [sync](docs/architecture/offline-sync.md), [security](docs/architecture/security.md) |
| P1-08 | Verify REA, locate target, retain evidence and identify supported safe methods | PASS — [research](docs/research/tally-workflows.md), evidence JSON |
| P1-09 | Run foundation checks and audit documents; record applicable checks, limitations and change summary | PASS — [verification record](docs/progress/phase-status.md) |
| P1-10 | Observe baseline company/period navigation in an isolated synthetic reference environment, or complete authorized manual observation with recorded actions/results | PASS — owner reported successful creation using defaults, FY/books configured to 01-01-2026, valid 01-02-2026 to 28-02-2026 accepted, inverted 28-02-2026 to 01-02-2026 blocked with sound only/no visible message, restoration and shutdown/reselection. Individual default values and reopened dates/period UNVERIFIED; record OP-P1-BASELINE-2026-10-25 |

Technical exit verdict: **100% COMPLETE — 10/10 mandatory criteria satisfied**, with verification evidence in [phase status](docs/progress/phase-status.md) and the [research record](docs/research/tally-workflows.md). The baseline criterion is navigation/actions/results, not proof of field-value persistence; no criterion was waived. Exact defaults, exact dates/period after reselection, and independent filesystem isolation remain unverified non-blocking research limitations, not application-release assurances. No unresolved Phase 1 blocking defect identified. Owner-reported reference tests are distinct from automated foundation checks; application tests/type/lint/build are not applicable because no application code exists.

Detailed owner evidence reassessed: all ten criteria remain satisfied. Successful creation using defaults is recorded without asserting individual setting values. The exact inverted-range inputs are now reported; reopened FY/books dates and reporting period remain explicitly unverified. This clarification does not constitute phase approval or authorize Phase 2.

Approval status: **APPROVED AND CLOSED — 2026-10-25** through the owner's later explicit “Implement phase 2” instruction. Earlier test reports did not grant approval; this instruction does. This historical Phase 1 gate permitted Phase 2. Phase 2 has since been approved/closed and Phase 3 explicitly authorized as recorded above.

Owner-requested **REQ-PERIOD-RANGE-01** was documented in Phase 1 and now has shared-domain/in-memory-boundary validation in Phase 2. Inline field highlighting, keyboard/screen-reader UX and real SQLite/PostgreSQL/IndexedDB enforcement remain scheduled for their approved runtime phases. The reference observation (audible-only rejection, no visible message) stays separate from our implementation/UX requirements.

## Phase 2 — Accounting Engine

Prerequisite satisfied: Phase 1 technically complete, approved/closed and Phase 2 explicitly authorized. Use the smallest TypeScript workspace and Vitest setup for pure domain/application code. Research informs original module design; inability to observe reference UI does not block independently specified/tested bookkeeping rules.

Executed plan: authorization and REA/target recheck; owner-directed official Tally help research before module design; npm workspace/domain/application implementation; invariant/concurrency/fault fixtures; build/type/lint/tests and built-package integration; scoped review and documentation. No production adapter or UI. The six original criteria are recorded below without changing scope.

| ID | Mandatory acceptance criterion | Result / evidence |
| --- | --- | --- |
| P2-01 | Company/currency/year/period/chart/ledger contracts enforce scope, classification, cycle prevention and structured invalid-range errors | PASS — defineBook/dateRange and chart tests; original names, no copied default catalog |
| P2-02 | Exact parsing, bounded money, string serialization and explicit rounding pass large/boundary fixtures | PASS — signed 64-bit minor units, exponents 0–6, exact bigint; wider report sums; money/calendar tests |
| P2-03 | Immutable balanced journals, drafts, openings and full linked reversals reject malformed/unbalanced/foreign records | PASS — domain and application tests, hand-worked J1–J5 fixture |
| P2-04 | Idempotent commands, version/period locks and atomic unit-of-work behavior with documented test adapter | PASS — duplicate/race, stale version, rollback, permission/scope and adapter immutability tests; memory only, no durability claim |
| P2-05 | Ledger and trial balance reconcile to journals/openings/reversals using the shared model | PASS — exact totals, opening/movement/closing balances, duplicate/corrupt input rejection and wide sums |
| P2-06 | Tests, type/lint/build, research, security/accounting/integration review and docs complete; report delivered | PASS — 103 tests, type/lint/build/built-package and repository checks passed; official-source research, scoped audits and completion report recorded |

Exit verdict: **100% technically complete — 6/6 mandatory criteria**. **APPROVED AND CLOSED — 2026-10-25** by “close phase 2 and implement phase 3”. Next permitted action is Phase 3 within its scope. Reference adapter guarantees remain in-memory only; unobserved Tally behaviors remain NOT VERIFIED. Engine correctness comes from independent fixtures/checks, not presumed reference equivalence.

## Phase 3 — Offline Desktop Application

Prerequisite satisfied: Phase 2 explicitly approved/closed. Add React/Tauri 2/SQLite only now; reuse the existing Vite tool rather than adding another bundler. Research company setup, offline entry, reports and recovery with supported read-only REA/official docs; mark unavailable UI behavior NOT VERIFIED. Implementation plan: verify native prerequisites; record transaction/security/backup design; build restricted native store plus TS adapter and original UI; test durable commits, isolation, interrupted writes/migrations, encrypted backup/restore; run native/UI/type/lint/build/resource checks and audit/docs. Each of the following six criteria remains mandatory and all-or-nothing.

| ID | Mandatory acceptance criterion | Result / evidence |
| --- | --- | --- |
| P3-01 | Original accessible shell provides company/year selection and keyboard entry using shared logic; inline/highlighted date errors block invalid apply/save with keyboard/screen-reader association (REQ-PERIOD-RANGE-01); no bundled Node server | PASS — real WebView2 keyboard/ARIA/focus checks and embedded frontend build |
| P3-02 | Versioned SQLite migrations, FKs, immutable journal constraints, valid period ranges, durable transactions and atomic outbox pass adapter contracts | PASS — Rust/SQLite and service/adapter tests; WAL/FULL/FKs readback, scoped migration and projection/outbox validation |
| P3-03 | Company/chart creation, posting/reversal and trial balance work offline; reopening preserves acknowledged local records and isolates companies | PASS — native service/process tests and real WebView2 offline journal/report/restart flow |
| P3-04 | Process-kill, disk-full and interrupted migration preserve consistency; consistent encrypted backup/restore work on synthetic data | PASS — native fault, migration rollback, backup/wrong-key/tamper/restore checks |
| P3-05 | Local-only mode, offline permission restrictions, credential handling and limited native IPC exist with accurate security limitations | PASS — native password/session/scope tests, sole main-window command capability, no SQL/shell/path IPC; plaintext DB limitation disclosed |
| P3-06 | Real Windows build, unit/integration/E2E checks, startup/resources, research, security/accounting audit and current docs pass | PASS — real debug/release Windows builds; 115 Vitest, 5 Rust and 5 WebView2 checks; type/lint/format/build, scoped advisory review, resource baseline and document validation; evidence in phase status |

Technical exit verdict: **100% — 6/6 mandatory criteria**, implementation and verification complete. **APPROVED AND CLOSED — 2026-10-25** by “Implement phase 4”. No unresolved Phase 3 release-blocking defect identified in the recorded checks. Current plaintext local-file protection, local-owner-only mode, small-book/debug resource baselines and non-Windows advisory coverage limits remain explicit in [phase status](docs/progress/phase-status.md) and [test evidence](docs/testing/phase3-evidence.json). Signed installer and release-scale assurance are later gates. Next permitted action: Phase 4 implementation within its scope; commit/push and deployment remain unauthorized.

## Phase 4 — Cloud Backend and Synchronization

Prerequisite satisfied: Phase 3 explicitly approved/closed by “Implement phase 4”. Add Node service, PostgreSQL, Prisma, authentication and protocol validation as required. Research authorized remote/multi-user behavior without inspecting production traffic.

Implementation plan: recheck read-only REA/official references; admit only required dependencies and isolated PostgreSQL tooling; implement bounded shared wire contracts and authenticated/RLS-protected server transactions; add explicit reviewed enrollment and native signed offline grants/outbox/canonical mirror; verify duplicate/lost-response/concurrency/revocation/conflict/restored-generation and incremental-recovery scenarios; complete real database/native/UI/build/security/accounting/docs gates. No external deployment.

| ID | Mandatory acceptance criterion | Result / evidence |
| --- | --- | --- |
| P4-01 | Authenticated company-scoped API and roles enforce authorization; least-privilege DB role, composite tenant keys and RLS tests block cross-tenant access. Shared validation and PostgreSQL boundaries reject inverted financial periods (REQ-PERIOD-RANGE-01). | PASS — authenticated role/company checks, actual non-owner/default-deny RLS and direct viewer-context isolation; API structured range and PostgreSQL CHECK tests |
| P4-02 | Server transactions atomically write command receipt, journal and change cursor; duplicate/reordered/retried commands and altered-payload reuse are handled safely. | PASS — 12 concurrent duplicate requests, altered-payload refusal, injected SQL/feed rollback, exact BIGINT/wide totals and posting/period/chart races |
| P4-03 | Desktop outbox retries safely; pending/accepted/rejected/conflict states and canonical reconciliation preserve immutable local evidence. | PASS — real native durable states, lost-ack/process restart, multi-device canonical reports, compensation/replacement and immutable source preservation |
| P4-04 | Incremental pull, bounded batches, version negotiation, gap recovery and acknowledgments recover from disconnects and lost responses without duplicates. | PASS — bounded cursor batches, protocol rejection, epoch/gap checks, lost acknowledgments and explicit restored-generation/receipt recovery |
| P4-05 | Period-lock, revocation, stale master, concurrent edit, backup-restore and local-only enrollment conflicts require deliberate resolution; no last-write-wins postings. | PASS — role/device withdrawal, stale chart/period conflicts, six-request device recovery race, encrypted backup restore, missing-history refusal and safe enrollment cancellation |
| P4-06 | Real PostgreSQL concurrency/isolation tests, API/desktop integration, lint/type/build, research, security/accounting review and docs pass; hosting remains a separate approval. | PASS — 146 Vitest, 8 Rust, 8 WebView checks; actual Windows/API builds, type/lint/native format, runtime smoke, scoped advisory/accounting/security reviews and current repository/docs evidence |

Phase 4 exit verdict: **100% technically complete — 6/6 mandatory criteria**, implementation and verification complete. **APPROVED AND CLOSED — 2026-10-26**, by “close and proceed to next phase”. See [phase report](docs/progress/phase-status.md) and [evidence](docs/testing/phase4-evidence.json). Closure approval is **granted**; Phase 5 is authorized. No commit, push or external deployment occurred. Next permitted action: implement Phase 5 within its approved scope.

## Phase 5 — Offline Web Application

Prerequisite satisfied: Phase 4 was technically complete and explicitly approved/closed. Introduce Next.js, IndexedDB and a service worker; browser behavior is independently designed, not a claimed Tally observation.

Plan: record authorized closure/research/dependency admission; extract the existing UI and CAS adapter for two hosts; implement strict IndexedDB commits/version upgrades and browser-only credential/grant/backup handling; add the public-shell service worker and fixed-origin API proxy; test actual browser offline/multi-tab/storage/update/conflict/recovery and desktop/cloud reconciliation; complete builds/audits/docs and stop for approval. No Phase 6 work or deployment.

| ID | Mandatory acceptance criterion | Result / evidence |
| --- | --- | --- |
| P5-01 | Next.js shell reuses UI/domain/application contracts and works after initial successful load without server rendering for offline routes. | OPEN — not yet verified |
| P5-02 | IndexedDB transactions atomically persist records/outbox; version upgrades and multiple-tab writers preserve invariants and isolation. Web period forms and IndexedDB writes enforce REQ-PERIOD-RANGE-01, including inline/highlighted accessible feedback and blocked invalid submission. | OPEN — not yet verified |
| P5-03 | Service worker caching, auth changes, stale clients and pending work survive controlled updates without leaking company responses. | OPEN — not yet verified |
| P5-04 | Web posting, sync/retry and conflict resolution pass shared adapter suites and reconcile with desktop/cloud fixtures. | OPEN — not yet verified |
| P5-05 | Quota denial, eviction, private mode, blocked upgrades and recovery produce explicit outcomes; persistence requests and backup export/import are verified. | OPEN — not yet verified |
| P5-06 | Supported-browser Playwright checks, lint/type/build, research, storage/security/accounting review and docs pass; unsupported modes declared. | OPEN — not yet verified |

## Phase 6 — Sales and Purchases

Prerequisite: Phase 5 approved; observe synthetic invoice, receipt, return and allocation workflows before design.

1. Customer/supplier masters and service invoices validate dates, prices, rounding and company references; invoice lifecycle cannot mutate posted journals.
2. Sales/purchase invoices generate balanced postings atomically and idempotently with document links and tested numbering rules.
3. Receipts, payments, credit/debit notes and partial allocations reconcile party balances; over-allocation and duplicates are rejected atomically.
4. Receivables/payables and aging reconcile to control ledgers; offline documents retain provisional versus accepted numbering/status.
5. Desktop/web workflows, offline recovery, cloud conflicts, permissions and reconciliations pass all quality gates and docs. Stock integration follows in Phase 7; no tax certification implied.

## Phase 7 — Inventory Management

Prerequisite: Phase 6 approved; observe synthetic item, warehouse, receipt/issue and return workflows.

1. Product/group/unit/warehouse masters validate exact quantities, scoping and safe hierarchy updates.
2. Atomic stock receipts/issues/transfers/adjustments prevent duplicates and enforce the approved negative-stock policy.
3. Approved valuation method passes hand-worked receipt/issue/return/correction fixtures; movements reproduce quantity and value.
4. Invoice-stock-journal integration commits all effects together and reconciles valuation to control accounts.
5. Offline conflicting issues, backdated movements and revaluation have safe outcomes; shared integration, all quality gates, research and docs pass.

## Phase 8 — Reporting and Compliance

Prerequisite: Phase 7 approved; observe synthetic reference reports; obtain independent current Uganda requirements and accountant review before tax design.

1. Profit/loss, balance sheet, cash flow, ledger, aging and inventory reports reconcile to canonical journals and disclose local pending/exceptions.
2. Company/period filters, comparative views and journal drill-through preserve authorization and reproducible as-of semantics.
3. Excel/PDF exports preserve exact values, reconciliation and safe content handling; large reports meet agreed budgets.
4. Effective-dated Uganda tax configuration and audit reports pass independent dated fixtures and accountant validation; no unverified rates.
5. Required EFRIS scope/access is resolved; if mandatory, approved sandbox integration and failure behavior pass before closure; local arithmetic alone does not establish compliance.
6. Report/export integration, permissions, lint/type/build, research, auditability/security/accounting reviews and docs pass.

## Phase 9 — Security, Performance, and Reliability

Prerequisite: Phase 8 approved. Earlier phases enforce security already; this phase broadens assurance.

1. Threat-model tests/review verify sessions, offline grants, tenant/RLS boundaries, native IPC, validation and audit access.
2. Concurrent posting, numbering, locks, revocation and sync failure campaigns preserve invariants.
3. Encrypted backup restores, key loss, interrupted upgrades and cloud recovery meet approved RPO/RTO in drills.
4. Representative data and hardware meet approved startup, latency, memory, sync and report budgets.
5. Dependency/license review, security findings, monitoring and support diagnostics are resolved; quality gates and recovery/accounting evidence/docs pass.

## Phase 10 — Production Readiness and Release

Prerequisite: Phase 9 approved. Publishing/deployment still require explicit owner permission.

1. Versioned signed Windows installer/updater pass clean-machine install/update/uninstall and rollback/migration tests; signing access available.
2. Approved deployment artifacts, secrets, migrations, monitoring and restore procedures pass staging verification.
3. User/admin docs, original branding, onboarding, support, privacy/terms and supported-platform matrix are reviewed.
4. Authorized pilot validates reconciliation, offline continuity and recovery with consented data under a separate handling plan.
5. Commercial entitlement/billing requirements are decided; only explicitly approved release scope is implemented and verified while preserving access to existing financial records.
6. Release candidate passes full quality/security/accounting/recovery gates with reproducible artifacts; owner explicitly approves release and any deployment.

## Scope and dependencies

- Every phase requires explicit predecessor closure. No parallel phase implementation, merged gates or silent skipping.
- Phase 3 supplies local-only accounting until Phase 4 sync. Phase 6 starts with service documents; Phase 7 adds stock integration. Final statements/compliance belong to Phase 8; trial balance belongs to Phase 2.
- No calendar promises before milestone-based estimates. Versions are selected/pinned when installed after compatibility/security review.
- Payroll, orders/BOM, Tally migration, on-premise network servers, multi-currency posting, subscriptions and licensing appeared in older plans; they are **not approved implementation scope** unless explicitly added. Uganda is a localization target; business tax registration/EFRIS obligations remain unconfirmed.
- Review choices and risk ownership in [decisions](docs/architecture/decisions.md). No future-phase dependencies have been installed.
