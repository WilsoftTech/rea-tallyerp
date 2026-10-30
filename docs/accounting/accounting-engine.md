# Accounting engine requirements

Status: **Phase 2 implemented** in `packages/domain` and `packages/application`, with 103 Vitest cases and emitted-package smoke verification. The owner's official-site research redirection was used before ledger/journal/report design; vendor behavior is not claimed as locally observed. These are original owner-required accounting rules, not copied reference implementation. Phase 3 now adds SQLite persistence and an original local-only desktop/authentication host; see the runtime documents and current verification record. Phase 4 adds server-authoritative execution of the same engine through Prisma/PostgreSQL, native offline delivery and a separate canonical mirror. Verification belongs to the current phase evidence.

## Phase 4 accounting integration

New receipts retain typed commands for exact offline delivery; legacy opaque receipt payloads are preserved, never reverse-guessed. External imports validate balanced history, exact reversal relationships, actor/timestamp syntax, matching immutable receipts/audit and scoped chart/drafts. Owner review does not turn historical local actors into authenticated cloud identities.

The service supplies the authenticated actor and trusted timestamp, checks current role/company assignment and expected versions, and executes the shared AccountingService inside one PostgreSQL transaction. BIGINT line persistence and wider NUMERIC balancing preserve signed-64 maximum values; derived reports still use bigint. Stable rejected/conflicting commands have immutable outcomes; transient SQL failures leave no outcome, journal or cursor change.

A separate canonical snapshot is used for accepted reports. Operational reporting deduplicates accepted IDs and adds eligible device-pending entries, excluding known exceptions and device-only compensation. Original local actor/timestamp/journals/receipts remain immutable. Shared master identity/classification is append-only once enrolled; edits go through the online authority.

Rejected journals can be offset on the source device before posting a new linked replacement under current dates/versions. An already rejected full reversal can be designated as compensation. A rejected reversal itself uses an exact opposite general contra journal, linked by resolution metadata, because the domain prohibits reversing a reversal. PostgreSQL accepts at most one replacement per rejected root. These are explicit corrections, with no silent date or payload rewrite.

## Implemented API and limits

Domain exports: `currency`, `minor`, `readMinor`, `writeMinor`, `parseAmount`, `formatAmount`, `addAmounts`, `roundRatio`; `businessDate`/`dateRange`; `defineBook`; journal validation/posting/full reversal; ledger statement and cumulative trial balance. `AccountingError` supplies stable code/message/field values, including `INVALID_PERIOD_RANGE` on `endDate`. Company currency/exponent is explicit; there is no product default currency. UGX/zero scale appears only in synthetic fixtures.

Money fields are signed 64-bit minor units; journal lines must be positive. Currency scale is an explicit integer 0–6. Decimal parsing rejects excess precision (no silent rounding); canonical integer serialization rejects leading zeros, exponents and negative zero. Decimal input may normalize negative zero to zero. Rational rounding requires an explicit toward-zero/half-away/half-even policy. Totals/projections use wider bigint accumulators because they are derived values, not persisted signed-64 fields. All date intervals are inclusive; end==start is allowed. Dates are actual YYYY-MM-DD calendar values, independent of timezone and wall clock.

Book contracts validate tenant/company scoping, unique IDs/names (trim/NFKC/lowercase within each chart collection), five accounting natures, matching child natures, cycles, ledger kinds, non-overlapping years/periods and period containment. `defineBook` creates configuration snapshots; Phase 3 adds initial company/year creation and selection; registered company/currency/books-from changes remain excluded. Registered company/currency/books-from changes require a later explicit migration contract.

Application exports: post, reverse, save/post draft, replace chart, set period status and authorized snapshot use cases. Principals are trusted host inputs, **not authentication**. Commands include unique scope-bound ID, explicit expected period/chart/draft versions as applicable. Reopening requires a distinct permission/reason. Exact canonical tagged payload strings bind actor+command for retry comparison; no crypto-digest/wire-protocol claim. Audit/receipt/journal/source-state changes commit together through the BookStore port.

General/opening/payment/receipt/transfer intents are implemented. Generic journals permit cash/bank; payment requires cash/bank credit(s) and no cash/bank debit, receipt vice versa, transfer only cash/bank. Opening journals balance exactly on books beginning. Unbalanced/incomplete drafts have no financial effect; posting validates full balance and makes the source immutable. Full reversals are new permanent opposite entries; only one full reversal of an original, no reversal-of-reversal, and no date earlier than original. An open later period can reverse a locked original. Report names use current chart labels; posted snapshots retain their original names/nature. Referenced ledger group/kind and group nature/parent cannot be reclassified by the chart command.

InMemoryBookStore is a reference/test adapter: isolated copied snapshots, serialized same-company transactions, revalidation on publication, append-only journal/receipt/audit guards and synthetic pre-commit rollback. It loses all state on process exit and offers no filesystem, multi-process or cloud durability. Production adapters must independently satisfy the same contract. There is no transactional outbox until Phase 3.

## Model and invariants

Company books have a base currency/exponent, books-from date, financial years/periods, hierarchical account groups, ledgers and immutable journal entries. Account natures are Asset, Liability, Equity, Income and Expense. Opening balances are balanced opening journals, never separate editable balances. Current earnings will reconcile equity/retained earnings in future reports; do not copy a vendor's default groups.

1. A journal belongs to exactly one tenant/company, business date, year and period. All referenced ledgers and source documents share that scope. No cross-company balancing.
2. At least two nonzero lines. Each line has one side, debit or credit, and a strictly positive bounded integer amount. Total debit equals total credit exactly. Reject overflow; never tolerate a rounding imbalance silently.
3. Money uses exact integer minor units plus explicit scale/currency. No JS number monetary arithmetic. Domain `bigint` serializes as canonical strings; parsing, formatting and storage round trips preserve all digits.
4. Drafts are mutable with optimistic versions. Posting creates an immutable snapshot; neither changing a draft nor renaming a ledger changes posted amounts/accounting classification.
5. Posted headers and lines cannot be edited/deleted. A full reversal creates a new balanced entry with opposite sides, linked to the original and audited reason. Reversal cannot masquerade as deletion.
6. Posting checks a currently open period and books-from/year bounds in the transaction. A reversal of an earlier locked period must use an authorized open date; never reopen/move dates implicitly.
7. Command ID uniqueness is scope-bound. Same ID/same payload returns the existing result; same ID/different payload fails. Independent IDs may still represent a semantic duplicate and need business reference controls.
8. Posting, receipt, audit and required outbox writes are atomic. No acknowledgment until durable adapter commit. Period lock and posting operations serialize consistently.
9. Trial balance/ledger totals derive from immutable entries, not user-editable running totals. All projections declare date/scope and local-pending versus server-accepted basis.
10. Authorization, schema and invariant failures have stable typed error codes and actionable messages. Errors do not partially persist financial effects.

REQ-PERIOD-RANGE-01 uses shared `dateRange`/`defineBook` at registration/commit boundaries, native and browser forms, SQLite and PostgreSQL constraints, and strict IndexedDB candidate validation. The owner-reported 28-02-2026 → 01-02-2026 case yields “End date must be on or after start date.” associated with `endDate`; invalid state is not published. Native/browser forms highlight the field, show inline text with ARIA association, focus it and block invalid submission. Current runtime verification is recorded by phase, not inferred from a domain test. Reference audible-only feedback remains separately attributed; no date/default persistence assumption is adopted.

Prevent duplicate full reversals with a scoped original-entry constraint; partial adjustments use separately modeled linked entries with accountant-approved limits. Exact credit-note/allocation policies belong to Phase 6. Year-end close/carry-forward will not duplicate opening effects when viewing multiple years; implementation requires an explicitly reviewed close policy in the affected phase.

## Shared posting flow

Application use cases accept validated commands, load scoped/versioned master and period state, call pure domain functions, then ask a unit-of-work adapter to atomically commit with rechecked preconditions. Inject clock/IDs and authority; the domain performs no SQL, I/O, framework calls or global time reads. Adapters enforce storage constraints as a second boundary; they do not reimplement tax, pricing or valuation calculations.

Generic journal, payment, receipt, transfer and opening intents are implemented under the independent rules documented above. Their restrictions follow approved accounting requirements, not assumed Tally equivalence. Reference UI gaps are **NOT VERIFIED**, separate from engine defects; standard double-entry correctness is verified using synthetic fixtures. Sales/purchase source documents and taxes remain out of Phase 2.

## Hand-worked acceptance fixture

Synthetic one-company base-currency units, no tax/inventory. The following independent expected values are now encoded and executed in the J1–J5 reconciliation test using exact minor units, plus application/reference-adapter integration cases.

| Journal | Debit | Credit |
| --- | --- | --- |
| J1 — owner funding | Cash 1,000 | Equity 1,000 |
| J2 — cash expense | Expense 200 | Cash 200 |
| J3 — credit sale | Receivable 300 | Revenue 300 |
| J4 — customer receipt | Cash 100 | Receivable 100 |

Expected trial balance after J4: Cash Dr 900; Receivable Dr 200; Expense Dr 200; Equity Cr 1,000; Revenue Cr 300. Debit total = credit total = 1,300. Profit = 100; assets 1,100 reconcile to equity plus profit 1,100 (before closing entries).

Full reversal of J2: Cash Dr 200 / Expense Cr 200, new journal J5 linked to J2. Expected after J5: Cash Dr 1,100; Receivable Dr 200; Expense 0; Equity Cr 1,000; Revenue Cr 300. Trial balance totals remain 1,300 each; J2 remains present unchanged. Posting J2 twice with the same command must not reduce cash twice.

Executed negative fixtures cover imbalance, zero/negative/invalid amounts, foreign scope/unknown ledger, locked/out-of-period/book-start dates, ID/payload mismatch, stale period/chart/draft versions, posted record mutation/deletion, duplicate full reversal, signed-64 overflow, above-safe-integer values and synthetic commit rollback. 100 simultaneous duplicate submissions produce one effect. Those Phase 2 checks did not claim real DB crash or multi-process coverage. Phase 3 verifies SQLite process recovery, two-process races, wide i64 readback, restoration and calendar extension. Phase 5 adds actual browser adapter/storage/recovery verification; its final results are kept in the current evidence record.

Phase 5 does not create another accounting engine. Both client hosts use the extracted `ClientBookStore` CAS adapter and original UI; `dispatchCommand` centrally routes the seven shared financial/master commands. The browser host replays each proposed transition with the trusted local principal through `AccountingService` before opening a write transaction, and rechecks revisions/authority inside it. Balanced payload tampering and forged actors are rejected by shared replay tests. The server independently dispatches through that same application; browser-supplied roles/actors never authorize cloud posting. Canonical prefix/master reconciliation and business-field journal matching are shared contracts; native Rust retains its separate defensive persistence validation, not a second source of accounting calculations.

## Precision and reporting decisions

Phase 2 implementation authorization selected explicit configurable scale 0–6 and signed-64 money fields, without selecting a business's currency or statutory policy. Future invoice/tax/FX rounding and residual allocation require accountant/owner review in those phases. No Uganda tax rates, currency exponent, FX or reporting compliance are inferred.

Future sales and inventory commands must produce the same journal model. Trial balance alone cannot prove correct account selection or prevent semantic duplicate transactions; fixtures and accounting review cover those risks. Report acceptance in Phase 8 includes balance sheet, profit/loss, cash flow and subledger reconciliation. Current documentation is an internal design specification, not tax or statutory advice.
