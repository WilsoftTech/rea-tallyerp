# Documentation index

Current state, 2026-10-25: Phase 1 approved/closed by “Implement phase 2”. Phase 2 accounting domain/application packages are implemented with 103 tests, an emitted-package smoke check and an in-memory reference adapter, **AWAITING USER APPROVAL**. No durable storage, authentication, desktop/web UI, sync service or installer exists. Date-range errors are implemented in shared domain/reference boundary; accessible inline UI remains a later-phase requirement. Reference runtime findings are owner-reported, Phase 2 vendor findings separately sourced; individual defaults and exact retained reference dates remain unverified. Phase 3 is blocked.

| Document | Responsibility |
| --- | --- |
| [Engineering instructions](../AGENTS.md) | Shared rules and phase protocol |
| [Claude rules](../CLAUDE.md) | Claude-specific working constraints |
| [Master roadmap](../ROADMAP.md) | Sole active phase plan, measurable gates and approval status |
| [Architecture overview](architecture/overview.md) | Proposed topology, package boundaries and nonfunctional requirements |
| [Decisions and risks](architecture/decisions.md) | Proposal register, alternatives and decisions requiring review |
| [Database](architecture/database.md) | Proposed logical entities and persistence constraints |
| [Offline synchronization](architecture/offline-sync.md) | Proposed states, atomicity, conflicts and recovery |
| [Security](architecture/security.md) | Proposed trust boundaries, permissions and protection controls |
| [Accounting engine](accounting/accounting-engine.md) | Proposed accounting invariants and worked acceptance fixture |
| [Tally workflows](research/tally-workflows.md) | Reference evidence, inherited claims and manual observation protocol |
| [Phase status](progress/phase-status.md) | Current progress, actual commands, limitations and change report |
| [Test strategy](testing/test-strategy.md) | Future verification by phase and current check scope |

[Old roadmap path](roadmap.md) redirects to the master. [Earlier Tally analysis](tally-analysis.md) is retained as historical material with a provenance notice; its workflow claims are not fresh runtime observations. Raw current evidence lives under `research/evidence/`; it contains executable metadata and tool capabilities, not business data or application assets.

Install pinned development tools with `npm.cmd ci --ignore-scripts --cache .cache/npm` (no global settings change), then run `npm.cmd run build`, `npm.cmd run typecheck`, `npm.cmd run lint`, `npm.cmd test`, `npm.cmd run check:built`, `npm.cmd run check:foundation`. The repository validator alone needs only Node, but does not certify accounting/build correctness. Source is under `packages/domain` and `packages/application`; no app runs yet.
