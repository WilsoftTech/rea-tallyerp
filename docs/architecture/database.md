# Database design

Status: Phase 2 logical contracts and InMemoryBookStore reference/test adapter are implemented. No physical schema, Prisma model, migrations, SQLite/IndexedDB/PostgreSQL adapter or production database exists. The memory adapter loses state at exit; its transaction tests do not establish disk durability. Physical schemas below remain proposals and must implement the same shared rules.

Current state lives in a scoped BookState: validated company/year/period/chart configuration, chart revision, immutable journal snapshots, draft/source versions, exact canonical command receipts and append-only audit events. Registration and every memory commit validate period ranges; posting/locks serialize per tenant/company. Copies prevent callers from mutating live state. Publication guards reject journal/receipt/audit deletion or edits and require each new journal's receipt/audit. No outbox is implemented yet. Period versions and referenced chart restrictions are enforced; real DB constraints/RLS/crash recovery await their phases. Ledger/trial-balance projections rebuild from entries, using wider bigint sums.

## Scope and logical entities

Tenant is the organization boundary; company is the accounting boundary. Tenant-level rows have tenant scope; company rows require both tenant and company. Financial year is an interval, not a separate copied ledger database. Do not duplicate a tenant row for every company/year.

| Planned entity | Key relationships and constraints | Phase |
| --- | --- | --- |
| Tenant, Company | Company belongs to tenant; base currency/exponent versioned and fixed after posting unless an explicit migration is approved | 2 contracts; 3 persistence |
| FinancialYear, FinancialPeriod | Company-scoped non-overlapping intervals; business dates, books-from date, open/locked status, version; year/period membership consistent | 2 |
| AccountGroup, Ledger | Company-scoped; group hierarchy acyclic; account nature Asset/Liability/Equity/Income/Expense; no deletion/reclassification of referenced historical accounting meaning | 2 |
| DraftVoucher | Mutable validated source document with version; posting creates immutable journal snapshot | 2 |
| JournalEntry, JournalLine | Company/year/period-scoped; balanced base-currency amount lines referencing same-company ledgers; immutable header and lines | 2 |
| CommandReceipt | Unique tenant/company/command ID, canonical payload digest, immutable outcome and result references; transactionally stored | 2 contracts; 3 local; 4 server |
| AuditEvent | Actor/device/scope, action, immutable resource reference, reason, timestamp and correlation; append-only | 2 contracts; 3 local; 4 server |
| OutboxCommand | Versioned payload, command/device IDs, expected versions, retry metadata; unique scope/command; references immutable local posting | 3 |
| User, Membership, RoleGrant, Device | Identity and scoped permission membership; offline grant separate from cloud session | 3 local; 4 cloud |
| SyncState, ServerChange | Company cursor/generation, schema version and canonical change sequence; atomic apply/cursor update | 4 |
| Party, Invoice, PaymentAllocation | Company-scoped customer/supplier and document links, exact allocations/control ledgers | 6 |
| Product, Warehouse, StockMovement, Valuation | Exact quantities and costs; append-only movements and journal links | 7 |
| TaxRuleVersion | Company/jurisdiction effective dates and source references; snapshot applied rules on documents | 8 |

Surrogate identifiers are opaque collision-resistant values created by platform cryptographic APIs; display numbers are separate. A provisional device-scoped number is never relabeled as a statutory final number without an explicit accepted mapping.

## Money, quantities and dates

Proposed domain representation: integer minor units (`bigint`) plus currency/exponent, bounded to signed 64-bit storage with explicit aggregate overflow checks. Journal line amounts are strictly positive with a debit/credit side; zero lines and mixed/negative signs are rejected. Canonical JSON encodes integer values as base-10 strings, never JS numbers. Validate canonical forms and limits at all boundaries.

SQLite stores INTEGER through an exact 64-bit binding; PostgreSQL stores BIGINT through Prisma BigInt handling; IndexedDB stores validated integer strings. Driver coercion to JS number is forbidden and must be tested with values above `Number.MAX_SAFE_INTEGER`. Report sums may require wider accumulators and explicit bounds. Exact rational/decimal quantities, unit prices and tax intermediates will be specified in Phases 6–8; no binary-float multiplication.

Business date uses a validated calendar date such as `2026-01-15` in company policy, separate from UTC event timestamps. Year/period intervals use documented inclusive/exclusive boundaries. Device timestamps do not prove server authorization or posting order. Company timezone is explicit and independent of this development machine.

REQ-PERIOD-RANGE-01 now rejects end-before-start in shared domain and memory registration/commit, returning a field-associated error and leaving state unchanged. Inclusive intervals allow a single day. SQLite/PostgreSQL/API/IndexedDB enforcement and their schema constraints remain deferred to the relevant approved phases; no physical schema exists yet. UI feedback/accessibility are separately specified future requirements, not database behavior.

## Transaction contract and constraints

One successful posting transaction must commit: receipt/idempotency claim, immutable header/lines, audit event and outbox record (when synchronization is relevant). Error or crash commits none. Storage adapters must check current period lock, same-company references and expected master versions inside the same transaction as the write. Prevalidation in TS does not close concurrent-update races.

Cloud/local SQL schemas require composite unique keys and foreign keys containing tenant/company identifiers. IDs alone never establish scope. Posted journals cannot be updated/deleted by normal application roles. Ensure a whole journal is balanced and has at least two lines at the persistence boundary: PostgreSQL deferred constraints/controlled posting function and SQLite guarded transaction/finalization constraints are candidates to prove in adapter implementation. Cross-row balance cannot be promised by an ordinary row CHECK. Do not expose arbitrary SQL or a mutable finalized header to renderers.

Browser storage has no hostile-user security perimeter. All normal writers must use one application transaction path; indexes, transaction scope and versions prevent accidental duplicates/mixed-company writes. Server validation remains mandatory for synchronization.

Period locks serialize with posting: PostgreSQL locks a period row in both close/post transactions; SQLite serializes relevant writes and verifies lock/version before commit. Browser transactions include period, masters, journal, receipt and outbox stores. Reclassification is versioned to preserve historical report meaning. Read models/balances are rebuildable caches, never independent financial truth.

## Engine-specific decisions and migrations

- SQLite: local disk, `foreign_keys=ON` per connection; proposed WAL and `synchronous=FULL`; bounded busy handling and serialized writes. Read back configuration because unknown PRAGMAs can be ignored. WAL is not a network-share collaboration mechanism. [SQLite PRAGMAs](https://www.sqlite.org/pragma.html)
- PostgreSQL: Prisma on the server only; raw SQL migrations may implement constraints/RLS that ORM declarations cannot express. Use a non-owner/non-BYPASSRLS runtime role, transaction-local trusted tenant context and FORCE RLS as appropriate; test context under connection pooling. [PostgreSQL RLS](https://www.postgresql.org/docs/18/ddl-rowsecurity.html)
- IndexedDB: atomic readwrite transactions include every affected store; no network awaits inside them. Expect blocked upgrades, quota errors, multiple tabs and browser-specific durability behavior. [MDN storage limitations](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)

Each adapter owns versioned forward migrations and fixtures. Keep command protocol version separate from schema version. Before destructive upgrades, verify a restorable backup; interrupted migration must preserve old or new valid state. Rollback of application binaries must not open an incompatible newer schema. Never auto-delete/reset a failed financial database.

## Backup and recovery requirements

SQLite snapshots must use its backup API or a verified quiescent strategy, not an isolated copy of a live `.db` with pending WAL. Browser export must include a consistent company snapshot, pending commands, receipts and schema manifest. Cloud backups need independent access and tested point-in-time recovery. Encrypt with maintained authenticated encryption and verify integrity before restore. [SQLite backup API](https://www.sqlite.org/backup.html)

Restore into a separate validated location, verify scope/balances/version/checksum, then atomically switch where supported. Preserve original bytes and evidence on failure. Re-register restored devices/generations and reconcile immutable command IDs with server receipts; do not replay with newly generated command IDs. See [sync recovery](offline-sync.md) and [security](security.md). No recovery guarantee has been implemented or tested yet.
