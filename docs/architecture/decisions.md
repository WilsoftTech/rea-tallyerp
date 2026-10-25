# Architecture decisions and risks

Status: Phase 1 foundation approved/closed and Phase 2 authorized on 2026-10-25 by “Implement phase 2”. Existing proposals guide Phase 2; runtime/compliance choices retain their later gates. Implemented facts are in [phase status](../progress/phase-status.md).

## Decision register

| ID | Proposal and rationale | Alternative considered / consequence | Review gate |
| --- | --- | --- | --- |
| D01 | npm workspaces and modular backend; preserve independent domain/application packages | Turborepo and microservices add operations/build cost without present evidence | Foundation review; create packages in Phase 2 |
| D02 | Pure TS domain; exact bounded integer money internally, decimal strings over JSON; explicit rational rounding | JS floating point rejected; an external decimal package only if required by future FX/tax use cases | Foundation review; numeric bounds/scale signed off before Phase 2 |
| D03 | React/Tauri 2 standalone frontend with narrow Rust SQLite IPC; Next.js browser host | Next static export is possible but server features do not run inside Tauri; embedded Node adds startup/memory costs | Foundation review; native adapter spike in Phase 3 |
| D04 | SQLite local ACID transactions, IndexedDB browser transactions, PostgreSQL cloud; independent adapters | Browser SQLite/WASM adds complexity and does not remove quota/eviction; one DB technology everywhere is unnecessary | Foundation review; adapter contract suites in Phases 3–5 |
| D05 | Immutable financial records, reversals and transactional command receipts; opening balances are journal entries | Mutable posted vouchers and independent stored balances undermine auditability | Foundation review; Phase 2 invariants |
| D06 | Server validates synchronized journals authoritatively; local pending books remain explicit | Last-write-wins and trusting client-reported permission/balance rejected | Foundation review; Phase 4 protocol |
| D07 | Local-only mode first; optional enrollment into sync requires reconciliation | Automatically treating standalone books as cloud-confirmed would misstate acceptance | Owner review before Phase 3; enrollment design Phase 4 |
| D08 | Tenant/company composite constraints, scoped authorization and cloud RLS with non-owner runtime role | ORM filters alone insufficient; table owners and BYPASSRLS roles can evade RLS | Foundation review; real DB isolation proof Phase 4 |
| D09 | Authentication provider undecided; independent offline authorization policy and device identity | Earlier Auth.js proposal does not establish secure offline login or revocation semantics | Select cloud auth before Phase 4; offline grant policy before Phase 3 |
| D10 | Original task-oriented UI with shared controls, explicit company/year/status and keyboard shortcuts | Reproducing Tally screen layout, iconography or shortcut system is not required | Owner design review in Phase 3 |
| D11 | Base currency per company initially; configurable currency exponent; business date separate from timestamps | Full FX accounting and one fixed two-decimal scale add incorrect assumptions | Owner/accountant review before Phase 2 |
| D12 | Reference observations inform workflows/UX; original standard accounting rules are independently specified and verified. Unobserved Tally behavior is NOT VERIFIED, not a defect by itself | Blanket manual-walkthrough gates would block standard logic without improving its correctness; manual requests require a specific material decision | Owner's Phase 2 clarification; no change to phase approval/financial quality gates |

## Dependency admission

Phase 2 dependency admission was recorded before installation: TypeScript for strict public contracts/declaration builds; Vitest for invariant/fixture tests; ESLint, @eslint/js and typescript-eslint for actual TS linting; @types/node 24 for test/tooling types. No existing installed compiler/test/lint commands or dependencies could be reused. Native Node executes stripped TS but does not replace type checking/declaration output; native assertions remain used for emitted-package smoke verification. All external additions are development-only; domain has no dependencies and application uses only the domain workspace.

Installed exact pins: TypeScript **6.0.3** (Apache-2.0), Vitest **5.0.5**, Vite **8.3.5**, ESLint **10.13.0**, @eslint/js **10.0.1**, typescript-eslint **8.72.0**, @types/node **24.19.2** (remaining licenses MIT). npm metadata showed typescript-eslint supports TypeScript <6.1, so the newer TypeScript 7.0.2 was not selected. Vitest 5 requires a Vite peer; Vite is installed only for test transformation, not an app/frontend build. Engine metadata is compatible with Node 24.22.1. `package-lock.json` pins the graph; installation used `--ignore-scripts`, and actual tests/build confirmed the installed prebuilt dependencies work. npm audit reported zero known vulnerabilities. Dev installation has disk cost; none of these tools is a domain runtime dependency. No UI/database/native app stack installed.

Environment: Node 24.22.1 and npm.cmd 11.19.1. npm.ps1 remains blocked by Windows policy. Registry metadata initially failed because npm's default cache is outside writable scope; use a workspace-local ignored `.cache/npm` without changing global configuration or execution policy. No escalation or machine-tool installation is required for that cache issue.

Phase 2 numeric choice under the implementation authorization: signed 64-bit integer minor units (-2^63 through 2^63-1), explicit currency code/exponent supplied by callers, supported exponent 0–6, no hard-coded base currency or Uganda tax/rounding assumption. Document exact validation/overflow behavior in implemented specification; future FX/invoice precision remains out of scope.

For each future installation, record: purpose within the active phase; search for existing solutions; native/small-code alternative; selected exact version/lockfile; license and maintenance/security status; approximate bundle/runtime effect; verification command. No bulk installation of the preferred stack.

| Phase | Candidate tools only when required | Alternatives / deferred cost |
| --- | --- | --- |
| 2 | TypeScript, Vitest, minimal ESLint tooling | Native assertions considered; Vitest aligns shared TS testing. No web/native dependencies |
| 3 | React, Tauri 2, minimal bundler, selected SQLite bridge, Tailwind/shadcn controls as needed, desktop test tooling | Native APIs first; shadcn source/dependencies reviewed individually, no entire component catalog |
| 4 | Node backend, PostgreSQL, Prisma, Zod at external boundaries, chosen auth | Reuse Node HTTP/fetch/crypto where adequate; no separate framework or queue by default |
| 5 | Next.js, minimal browser E2E tooling, IndexedDB API wrapper only if native API proves insufficient | Service worker and storage APIs native; no state/store/PWA library by default |
| 6–10 | Export, encryption, compliance, packaging libraries only against concrete requirements | Use maintained cryptography libraries/platform facilities, never custom cryptographic primitives |

No Rust/Cargo was found on PATH; Windows build tools and WebView2 were not probed. This is a later Phase 3 prerequisite, not a reason to install anything now. PostgreSQL, authentication services, cloud access and signing infrastructure were not provisioned or verified.

## Risks and decisions requiring owner input

These owners are proposed responsibilities, not assigned people. Unresolved future decisions do not justify implementing out of phase.

| Risk / question | Proposed mitigation and accountable role | Required by |
| --- | --- | --- |
| Windows REA cannot observe native UI | Phase 1 baseline is owner-reported; other UI coverage is NOT VERIFIED. Use supported read-only analysis/docs as informative context; standard accounting rules have independent synthetic tests. Request manual observation only for a specific material unresolved decision | Research limitation, not a Phase 2 implementation blocker; no independent UI/filesystem audit claimed |
| Product/customer assumptions inherited from old plan | Owner confirms name, standalone vs synchronized mode expectations, companies/users and base currency; no inherited VAT-registration claim | Currency before Phase 2; remaining design before affected phase |
| Offline rights versus revocation and clock rollback | Security lead proposes bounded offline grants, expiry behavior and read/export access; owner approves maximum disconnected duration | Phase 3 |
| Local confidentiality and lost backup key | Security lead evaluates OS-backed keys, database encryption costs and passphrase recovery; owner approves recovery tradeoff | Phase 3 |
| Server rejects an offline posting or lock changes concurrently | Engineering retains local immutable evidence and explicit reconciliation; accountant approves period/correction policy | Phase 2 contracts; Phase 4 integration |
| Multiple devices oversell stock or allocate invoice numbers offline | Device-scoped provisional IDs; owner/accountant approves negative-stock and legal numbering rules; no guaranteed global reservation offline | Phases 6–7 |
| Browser eviction and power-loss durability | Persist request, storage estimates, backup/export, explicit pending state and tested failure handling; desktop recommended where stronger guarantees required | Phase 5 |
| Uganda tax obligations/EFRIS access change | Owner/accountant obtains dated URA material and credentials to authorized sandbox; effective-dated configuration; no assumed rates | Phase 8 |
| Inventory valuation/backdating complexity | Accountant chooses valuation and negative-stock rules before implementation; deterministic movement fixtures | Phase 7 |
| Recovery/data residency and operational expense | Owner sets region, retention, cloud RPO/RTO and backup custody. Proposed starting targets: local daily backup (up to 24h device-loss RPO), cloud 15-min RPO / 4h RTO; subject to infrastructure proof | Phase 4 design; Phase 9 drill |
| Commercialization extends scope | Owner separately approves subscriptions, licensing, payments, on-premise server distribution and migration | Before any added feature |

## Technical research used

Sources consulted on 2026-10-25. These establish platform constraints, not our implementation or Tally behavior.

- [Tauri Next.js integration](https://v2.tauri.app/start/frontend/nextjs/) requires static export for that integration; separate React desktop host is our architectural choice.
- [Tauri security model](https://v2.tauri.app/security/) describes the WebView/native trust boundary; specific IPC constraints are our requirements.
- [SQLite synchronous settings](https://www.sqlite.org/pragma.html#pragma_synchronous) describe WAL FULL versus NORMAL durability; planned settings must be read back and fault-tested.
- [SQLite online backup](https://www.sqlite.org/backup.html) provides a consistent backup mechanism; encryption and restore workflow are our design work.
- [Browser storage quotas/eviction](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria) documents storage loss and persistence limits; we cannot guarantee retention.
- [PostgreSQL row security](https://www.postgresql.org/docs/18/ddl-rowsecurity.html) documents default-deny and owner/BYPASSRLS behavior; our runtime role must not bypass it.

No jurisdictional legal/compliance advice is inferred from these technical sources. Uganda statutory research belongs to its approved phase.
