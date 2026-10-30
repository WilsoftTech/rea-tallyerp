# Documentation index

Current state, 2026-10-30 (client date): Phases 1–4 approved/closed. Phase 5 adds the Next.js/IndexedDB browser host, shared React workspace, public-only offline shell and browser synchronization/recovery. Implementation and verification are complete (6/6) and awaiting owner approval; [phase status](progress/phase-status.md) is the current authority and [Phase 5 evidence](testing/phase5-evidence.json) records results. [Phase 4 evidence](testing/phase4-evidence.json) remains historical. Phase 6 and later modules remain blocked. Missing Tally UI observations stay NOT VERIFIED and distinct from our independent tests.

| Document | Responsibility |
| --- | --- |
| [Engineering instructions](../AGENTS.md) | Shared rules and phase protocol |
| [Claude rules](../CLAUDE.md) | Claude-specific working constraints |
| [Master roadmap](../ROADMAP.md) | Sole active phase plan, measurable gates and approval status |
| [Architecture overview](architecture/overview.md) | Implemented topology, package boundaries and future runtime requirements |
| [Decisions and risks](architecture/decisions.md) | Proposal register, alternatives and decisions requiring review |
| [Database](architecture/database.md) | SQLite/PostgreSQL migrations, constraints and operations |
| [Offline synchronization](architecture/offline-sync.md) | Implemented protocol, authority, retries, conflicts and recovery |
| [Security](architecture/security.md) | Implemented trust boundaries, permissions and explicit protection limits |
| [Accounting engine](accounting/accounting-engine.md) | Shared accounting implementation, integrations and worked fixture |
| [Tally workflows](research/tally-workflows.md) | Reference evidence, inherited claims and manual observation protocol |
| [Phase status](progress/phase-status.md) | Current progress, actual commands, limitations and change report |
| [Test strategy](testing/test-strategy.md) | Current check prerequisites/evidence and later verification gates |

[Old roadmap path](roadmap.md) redirects to the master. [Earlier Tally analysis](tally-analysis.md) is retained as historical material with a provenance notice; its workflow claims are not fresh runtime observations. Raw current evidence lives under `research/evidence/`; it contains executable metadata and tool capabilities, not business data or application assets.

Use the [root README](../README.md) for development prerequisites and commands. Full tests require real local PostgreSQL, the native harness, embedded test executable, production web build and Chrome/Firefox/Edge; missing infrastructure fails visibly. Source is under packages/domain, packages/application, packages/contracts, packages/workspace, apps/desktop, apps/api and apps/web. Historical phase evidence is retained separately.
