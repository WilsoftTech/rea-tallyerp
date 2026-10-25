# Master implementation roadmap

Updated: 2026-10-25 (Africa/Nairobi). Active authorization: **Phase 2 only**. Owner approval record: **“Implement phase 2”** authorizes Phase 1 closure and Phase 2 implementation after recorded Phase 1 technical completion. No later phase is authorized. This ten-phase plan supersedes the earlier `docs/roadmap.md` schedule. Original software only; no Tally implementation or distinctive UI is reused.

## Current status

| Phase | Progress | Implementation status | Verification status | Approval status |
| --- | --- | --- | --- | --- |
| 1 — Architecture and Foundation | 100% (10/10) | COMPLETE — foundation and baseline documentation | COMPLETE — foundation checks and owner-reported manual baseline | APPROVED AND CLOSED — 2026-10-25 |
| 2 — Accounting Engine | 100% (6/6) | COMPLETE — shared accounting engine and reference adapter | COMPLETE — 103 tests, type/lint/build, built-package and repository checks | AWAITING USER APPROVAL / not closed |
| 3 — Offline Desktop Application | 0% | Not started | Not run | Blocked by Phase 2 |
| 4 — Cloud Backend and Synchronization | 0% | Not started | Not run | Blocked by Phase 3 |
| 5 — Offline Web Application | 0% | Not started | Not run | Blocked by Phase 4 |
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

Approval status: **APPROVED AND CLOSED — 2026-10-25** through the owner's later explicit “Implement phase 2” instruction. Earlier test reports did not grant approval; this instruction does. Next permitted action is Phase 2 within its approved scope; Phase 3 remains blocked.

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

Exit verdict: **100% technically complete — 6/6 mandatory criteria**, implementation and verification complete within Phase 2 scope. Phase 2 closure approval is **not granted**. **AWAITING USER APPROVAL — NEXT PHASE BLOCKED**. Next permitted action: explicit owner approval to close Phase 2 and authorize Phase 3; do not start native desktop work automatically. Reference adapter guarantees are in-memory only. Unobserved local ledger/voucher behaviors are **NOT VERIFIED**, recorded separately from implementation defects; the original engine's correctness is established by its independent fixtures/checks, not presumed Tally equivalence.

## Phase 3 — Offline Desktop Application

Prerequisite: Phase 2 approved. Add React, Tauri 2, a minimal frontend bundler and SQLite only now. Research company setup, offline entry, reports and recovery first.

1. Original accessible desktop shell provides company/year selection and keyboard entry using shared domain logic; date-range validation shows a clear inline error/highlight, blocks invalid apply/save and supports keyboard/screen-reader correction (REQ-PERIOD-RANGE-01). No bundled Node server.
2. Versioned SQLite migrations, foreign keys, immutable journal constraints, valid financial-period ranges (REQ-PERIOD-RANGE-01), durable local transactions and atomic outbox pass adapter contract tests.
3. Company/chart creation, posting/reversal and trial balance work offline; reopening preserves acknowledged local records and isolates companies.
4. Process-kill recovery, disk-full handling and interrupted migration preserve consistency; consistent encrypted backup and restore work on synthetic data.
5. Local-only mode, offline permission restrictions, credential handling and limited native IPC are implemented with accurate security limitations.
6. Real Windows build, relevant unit/integration/E2E checks, startup/resource measurements, research, security/accounting review and documentation pass.

## Phase 4 — Cloud Backend and Synchronization

Prerequisite: Phase 3 approved. Add Node service, PostgreSQL, Prisma, authentication and protocol validation as required. Research authorized remote/multi-user behavior without inspecting production traffic.

1. Authenticated company-scoped API and roles enforce authorization; least-privilege DB role, composite tenant keys and RLS tests block cross-tenant access. Shared validation and PostgreSQL boundaries reject inverted financial periods (REQ-PERIOD-RANGE-01).
2. Server transactions atomically write command receipt, journal and change cursor; duplicate/reordered/retried commands and altered-payload reuse are handled safely.
3. Desktop outbox retries safely; pending/accepted/rejected/conflict states and canonical reconciliation preserve immutable local evidence.
4. Incremental pull, bounded batches, version negotiation, gap recovery and acknowledgments recover from disconnects and lost responses without duplicates.
5. Period-lock, revocation, stale master, concurrent edit, backup-restore and local-only enrollment conflicts require deliberate resolution; no last-write-wins postings.
6. Real PostgreSQL concurrency/isolation tests, API/desktop integration, lint/type/build, research, security/accounting review and docs pass; hosting remains a separate approval.

## Phase 5 — Offline Web Application

Prerequisite: Phase 4 approved. Introduce Next.js, IndexedDB adapter and service worker. Browser-specific behavior is our design requirement, not a Tally observation.

1. Next.js shell reuses UI/domain/application contracts and works after initial successful load without server rendering for offline routes.
2. IndexedDB transactions atomically persist records/outbox; version upgrades and multiple-tab writers preserve invariants and isolation. Web period forms and IndexedDB writes enforce REQ-PERIOD-RANGE-01, including inline/highlighted accessible feedback and blocked invalid submission.
3. Service worker caching, auth changes, stale clients and pending work survive controlled updates without leaking company responses.
4. Web posting, sync/retry and conflict resolution pass shared adapter suites and reconcile with desktop/cloud fixtures.
5. Quota denial, eviction, private mode, blocked upgrades and recovery produce explicit outcomes; persistence requests and backup export/import are verified.
6. Supported-browser Playwright checks, lint/type/build, research, storage/security/accounting review and docs pass; unsupported modes declared.

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
