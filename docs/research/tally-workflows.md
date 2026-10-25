# Reference workflow research

Investigation date: 2026-10-25 (Africa/Nairobi). Scope: understand observable accounting workflows and record navigation/validation for an independently designed ERP. No proprietary implementation, branding, assets or distinctive interface design may be copied. No security/licensing bypass. The owner's statement that Tally is legally installed authorizes bounded study; it does not establish permission for every possible analysis technique.

Current Phase 1 baseline status: **COMPLETE — OWNER-REPORTED MANUAL OBSERVATION**; Phase 1 was later approved/closed by “Implement phase 2”. P1-10 covers baseline company/period navigation, not specific retained values or reference accounting correctness. Phase 2 research uses the owner's official-source redirection, documented below; its technical engine checks are separate from reference observations. Phase 2 closure approval remains pending.

## Evidence classes and provenance

Current owner policy: reference research informs workflows and UX, not a requirement to reproduce Tally. Use supported read-only REA methods, label unobserved UI behavior **NOT VERIFIED**, and keep independent engine results out of reference observations. Standard accounting principles and approved requirements may be implemented/verified without access to the reference UI. A manual request must identify a specific unresolved behavior and the material design decision it affects; no new request is warranted for the completed Phase 2 engine. This clarification is not Phase 2 closure approval or Phase 3 authorization.

| Label | Meaning |
| --- | --- |
| OBS-STATIC | Reproduced now through safe metadata inspection; never runtime behavior |
| OBS-PROCESS | Agent-owned launch/process/window-handle metadata; does not establish visible UI content or company behavior |
| OBS-RUNTIME | Actions/results directly observed now in a controlled synthetic company; **none yet** |
| OPERATOR-RUNTIME | Normal UI behavior reported by the owner/operator, attributed explicitly; not independently captured by the agent |
| INHERITED | Claim from the pre-existing analysis; original supporting artifact/tool transcript not available in this workspace |
| VENDOR-DOC | Independently read vendor documentation; identifies intended behavior, not locally observed behavior |
| PROPOSED | Our independent requirement/design or planned experiment |
| UNKNOWN | Not established by available evidence |

The previous [Tally analysis](../tally-analysis.md) contained manual-derived claims labelled `[M]` and metadata claims labelled `[V]`. Those historical labels are preserved but are not reproduced evidence from this pass. No bundled manual, saved REA transcript or runtime capture accompanied the two original Markdown files. Do not promote its shortcuts, validation rules, default groups, file-format inferences or customer usage assumptions to verified requirements.

## Current investigation ledger

| Question | Finding / evidence | Coverage and limitation |
| --- | --- | --- |
| Is REA MCP connected? | OBS-STATIC: `mcp__rea__inspect_pe_certificates` and `mcp__rea__binary_session` returned structured results; session reports REA server/package 6.8.0 | Actual calls succeeded; skill availability alone was not treated as connectivity |
| Where is Tally? | OBS-STATIC: `C:\Tally.ERP9\tally.exe`; Windows version metadata: file 1.0.4.93, product Series A Release 4.93, 7,198,096 bytes | Three explicit paths checked, not an exhaustive disk search |
| Are other copies present? | OBS-STATIC: `D:\Tally.ERP9\tally.exe` and `D:\Tally.ERP9 2\tally.exe` have same reported file/product version and length | Content equality and safe data/configuration isolation were **not** verified; do not treat them as test installs |
| What is executable identity? | OBS-STATIC: PE32+, x86-64, SHA-256 `be0ba3120ae514d485a059d5cf07018dd8a67ebcd289dd6e66bd113db6581c54` | Contradicts inherited Win32 description; architecture says nothing about accounting workflows |
| Can it be inspected safely? | OBS-STATIC: bounded read-only executable identity/certificate parsing succeeded without target execution or company/configuration reads | Certificate structure only; not a signature/trust/license verification and not a blanket runtime safety finding |
| Can REA observe native Windows screens? | OBS-STATIC: session tool availability reports `capture_native_ui_scenario` and `observe_native_ui` unavailable, `unsupported_host`, requiring macOS | Supported Windows PE tools are not native UI automation. Installing a decompiler would not fix this UI limitation |
| Was a running target inspected? | OBS-PROCESS: controlled candidate launch eventually produced a responding window, PID 25336; no UI text/actions or company data inspected | Earlier process snapshots changed from empty to three processes, then empty after owner closed sessions. No debugger/attachment/instrumentation; active configuration still requires operator verification |
| Are company/year workflows verified? | OPERATOR-RUNTIME: owner confirms synthetic company creation using defaults, explicit year/books dates, valid period acceptance, rejection of 28-02-2026 to 01-02-2026, and successful shutdown/reselection | P1-10 PASS for baseline navigation. Individual default values and exact values after reselection remain UNVERIFIED; no independent agent UI capture |

Full current REA artifact Evidence: [tally-executable.json](evidence/tally-executable.json), evidence ID `ev_ad144ad2abcf6e4584b5cad314a69d76ed44e634b3f1f3eb8efb121043316063`, provider `rea-pe-certificates` v1. Limitations: no signature, chain, timestamp or image-digest verification; PKCS#7 fields are structural; Teletex uses an ISO-8859-1 compatibility mapping. No claims about certificate validity or trust are made.

[rea-capabilities.json](evidence/rea-capabilities.json) retains selected availability fields from the session response, explicitly not a full evidence bundle. No active binary was opened, no native analysis database was created, and session state was closed/no cleanup pending. Exporting the entire shared REA evidence ledger was avoided because unrelated retained records were outside this investigation.

## Supported methods and scope

| Method | Decision |
| --- | --- |
| Explicit executable version/hash/certificate structure | Used for target identity only; reads executable, not company or licensing records |
| REA session capability inspection | Used to establish supported host methods and limitation |
| Native PE import/resource/managed metadata tools | Some available; unnecessary for current workflow questions, not invoked |
| Native decompilation / debugger / memory instrumentation | Outside this project's authorized behavioral study; not used |
| REA native UI observation | Not supported on this host; use manual protocol below |
| Normal UI with isolated synthetic data | Candidate launched with separate working directory/skip-loading switches; owner confirmed expected lab paths/no company initially, then completed the synthetic baseline and reported results |
| XML/ODBC/export integration | Deferred; only a separately scoped test environment through documented features, never production data/server configuration |
| Existing company data, licence files, crash dumps, customer exports | Excluded; contents not read in this pass |

There was no need to install REA, repair MCP configuration, add Ghidra or acquire another engine. We did not run broad recursive inventory over a Tally installation that might probe business files.

## Synthetic lab preparation follow-up

The following setup/launch subsections are a chronological history. Their pending states describe those earlier milestones, not the final baseline outcome recorded below.

The owner confirmed that no separate synthetic environment exists and that one needs preparation. Prepared now: workspace-local `local-data/reference-lab/`, ignored by Git, with empty `app/` and `data/` directories and separate `config/`, `exports/` and `observations/` directories. `manifest.json` records **SKELETON_PREPARED_NOT_RUN**; `scenario.json` contains only invented company/period inputs; `config/tally.ini.draft` is inactive; `observations/baseline.json` has **NOT_RUN** status and null actual results. No vendor executable, asset, licence or existing configuration was copied. This is a prepared lab skeleton, not a working or proven-isolated Tally runtime.

REA connectivity was rechecked through `binary_session`: 6.8.0, no active target/cleanup and native UI still unsupported on Windows. An independent SHA-256 read of the selected executable still matches the recorded identity. Nine explicit `install.exe`, `install64.exe` and `setup.exe` paths under the three known application locations returned no files; this was not a general search of user downloads or disks. An official installer path has been requested. [Preparation evidence](evidence/reference-lab-preflight.json) records the scope and open blockers without private data.

Fresh VENDOR-DOC findings, not OBS-RUNTIME:

| Source | Documented behavior | Our bounded conclusion |
| --- | --- | --- |
| [ERP 9 installer directory options](https://help.tallysolutions.com/docs/te9rel49/Installation/Installing_64bit_Gold_User_Client.htm) | Application/data/configuration directories can be selected; installer can retain an earlier installation's data path | Review every test path explicitly; defaults are not isolation. This does not authorize selecting a licence-server mode or changing production licensing |
| [Company loading](https://help.tallysolutions.com/docs/te9rel65/Maintaining_Company_Data/Company_Info/Loading_a_Company.htm) | `Default Companies = No` prevents configured automatic company loading | Used only in the inactive draft; no original INI edited |
| [Command-line options](https://help.tallysolutions.com/docs/td9rel54/tdlreference/release_1_5.htm) | `/NOINILOAD` skips configured company preload; `/NOINITDL` skips configured additional TDL loading | Possible safeguards only; neither documents alternate INI selection or proves filesystem/network isolation |
| [Data configuration](https://help.tallysolutions.com/docs/te9rel53/Maintaining_Company_Data/F12_Config/data_configuration.htm) | Data/export/configuration paths and startup-loading settings are configurable | Review in an independently configured test runtime, never by opening production to edit its settings |

At the initial skeleton-preparation milestone no alternate-configuration mechanism had been established, so no runnable launcher was created and no Tally process was started. The draft intentionally omitted licence/server/extension settings and was not a complete installer profile. The follow-up below records later vendor documentation and a guarded candidate launcher; runtime behavior is still unverified.

At that preparation milestone the next action was to identify a test runtime/profile, configure lab paths and record actual observations before satisfying P1-10. Installer defaults/licensing changes were not accepted automatically. The subsequent documented working-directory approach and completed owner report supersede that preparation blocker. Folder separation is not a filesystem sandbox; no isolation/security guarantee is claimed.

### Installed-executable follow-up and candidate launcher

The owner supplied `C:\Tally.ERP9\tally.exe`. Fresh Windows version metadata identifies it as the installed Tally.ERP 9 application, file 1.0.4.93 / Series A Release 4.93, with the same SHA-256 as the retained Evidence. It is not identified as an installer; no installation command was attempted.

New VENDOR-DOC: [Tally.Developer 9 execution preferences](https://help.tallysolutions.com/docs/td9rel54/td9/tally_developer_tools/preference.htm) describes selecting a Tally.ERP 9 executable and specifying the INI location through its working directory. This supports a candidate working-directory launch without copying the executable. It does not prove behavior of this local 4.93 executable; an attempted release-4.9 documentation URL was inaccessible. No `/INI` switch is invented.

Prepared `config/tally.ini` inside the ignored lab, preserving `tally.ini.draft`. The candidate contains only the synthetic data/export paths, disabled company preload and disabled user TDL. [Guarded launcher](../../tools/reference-lab.mjs) validates those exact settings and the executable hash, then checks for existing `tally` processes. It reads no production INI/company/licence files. Default invocation, `node tools/reference-lab.mjs`, checks only. Explicit `--launch` uses the lab config directory as the working directory with `/NOINILOAD` and `/NOINITDL`, and still refuses if another Tally process is present.

Executed check result: **BLOCKED_EXISTING_TALLY_PROCESSES**, exit 2. Process-name snapshot: IDs 8732, 17740 and 25584, each reporting no main window handle. Their executable paths, ownership, active companies and configuration were not inspected; they were not terminated, attached or modified. Nothing was launched. These process observations supersede the earlier empty process snapshot; they do not establish how the processes started.

Next action: owner resolves existing sessions normally after saving any work. Do not kill unknown/background processes to clear the guard. Once the guard reports no matching processes, a controlled interactive launch is possible, but the operator must verify the displayed data/config/export paths before company selection or creation. If paths differ or real company information appears, stop; do not proceed or capture customer data. If licensing/resources prevent normal startup, record that limitation without copying licences or switching to production defaults. No automatic company actions, screenshots or input injection are part of the launcher.

At that milestone the manifest recorded **PROFILE_PREPARED_NOT_RUN**, `runtimeMode=reuse-installed-executable` and `runtimeIsolationVerified=false`. Separate installation had not been demonstrated necessary; existing sessions still prevented the candidate launch and P1-10 was open then. The later launch/operator baseline supersedes that status.

### Controlled launch after owner closed sessions

The owner reported saving and closing sessions normally. A fresh guarded preflight returned **READY_FOR_CONTROLLED_LAUNCH**, exit 0, with no matching Tally processes. REA remains connected, but still cannot observe native UI on this host.

Executed `node tools/reference-lab.mjs --launch` with the candidate working directory and both skip-loading switches. Initial spawn PID 12712 was observed, but that PID was absent at the follow-up; no exit code or cause was captured. This was not a successful-window observation. The possibility that tool-session cleanup affected lifetime was a hypothesis only.

The launcher was then changed to retain the parent session and capture the child's eventual exit. The changed launch ran in tool session 57965 and spawned PID 25336. A targeted process query found that PID present, responding, with main window handle 6490736. This verifies a responding native window exists, **not** the active data path, empty-company state or configuration selection. No window text, screenshots, company data, original configuration or licence records were read. No UI input was injected.

The operator was asked, before company selection/creation, to inspect normal F12/Data Configuration and confirm data/config/export point to the lab `data/`, `config/` and `exports/`, with no company loaded. The confirmation is recorded below. The target can access files under the user's normal OS authority; filesystem isolation was not traced or enforced. Do not claim the production store was untouched by the target merely because no agent command addressed it.

At this launch milestone the manifest/evidence state was **LAUNCHED_AWAITING_OPERATOR_PATH_VERIFICATION**, `runtimeIsolationVerified=false`; data directory was empty at the initial post-spawn follow-up. Subsequent operator evidence supersedes that pending-path state below. Leave the retained session available for the owner; no forced termination or automatic phase advancement.

### Owner-reported path confirmation

OPERATOR-RUNTIME, 2026-10-25: in reply to the bundled path/empty-company question, the owner stated: **“All three paths match, and no company is loaded.”** The question specified the lab's `data/`, `config/` and `exports/` paths. This supports displayed configuration matching the prepared profile and no loaded company at that observation. The agent did not independently inspect the configuration screen or filesystem accesses. No claim of an OS sandbox, continuous isolation or observed company creation follows from it.

Recorded the exact reply and its scope in preparation evidence and local `observations/baseline.json`. Baseline status is **IN_PROGRESS_OPERATOR_REPORTED**, first step recorded, four remaining step results null. Manifest observation state is **PATHS_CONFIRMED_BY_OWNER_AWAITING_BASELINE**; `runtimeIsolationVerified` remains false because no independent access/isolation audit was performed.

A bundled remaining walkthrough was requested: create `Synthetic Reference Lab` in the confirmed data directory with financial year/books from 1 January 2026, inspect/select it, set a valid February period, try a reversed date range and record the actual outcome, then shut/reselect the synthetic company and report retained values. These actions/results are **pending**, not observations. The [vendor's release-4.9 company creation guide](https://help.tallysolutions.com/docs/te9rel49/01_MAINTAINING_COMPANY_DATA_IN_TALLY/01_Company_Information/Creating_a_Company.htm) documents Alt+F3 company creation, the Directory field, financial-year/books-from fields and Alt+F2 period selection. Its instructions are source guidance, not proof of local validation behavior. Record restrictions/defaults rather than bypassing them.

At this earlier milestone Phase 1 stayed at 9/10 mandatory criteria (90%); P1-10 required the remaining actual results. Owner path confirmation was not phase approval. The launcher source now rereads the manifest when a future child exits to preserve concurrent manual status updates; the already running launch loaded the earlier script, so baseline/evidence records are authoritative and any old exit snapshot must be reconciled after it ends.

## Completed manual baseline — owner report

Observation record: **OP-P1-BASELINE-2026-10-25**, source **OPERATOR-RUNTIME**. The owner explicitly reported completing the requested manual tests in the previously confirmed synthetic lab configuration. REA/agent did not capture these screens, the warning sound or input actions. Findings apply to this reported walkthrough only; do not generalize to all reference versions/configurations.

| Action / input reported by owner | Actual outcome reported by owner |
| --- | --- |
| Create `Synthetic Reference Lab` | Company creation completed successfully using the default settings, with no additional reported restrictions/errors. Individual default values were not enumerated and must not be invented |
| Set financial year and books beginning | Both set to **1 January 2026**, with **no opening balances**; these are explicit test inputs, not observed defaults |
| Apply accounting period **1–28 February 2026** | Valid period accepted |
| Attempt period **28-02-2026 to 01-02-2026** (end before start) | Owner's detailed follow-up supplies these exact inputs. Tally prevented proceeding and produced an **audible warning only**; **no visible error message** appeared |
| Restore the valid accounting period | Restored successfully |
| Shut down and reselect the synthetic company | Both operations succeeded. This confirms navigation/reselection, not specific retained field values |
| Other tested operations | Completed without reported errors; the general statement does not establish unspecified behaviors |

**Unverified:** individual default setting values; financial-year and books-beginning dates after reopening (owner explicitly did not separately verify them); exact reporting period after reopening (owner explicitly did not report it); separately reported restored date values; focus/keyboard/screen-reader behavior in the reference; a full application restart/crash-recovery outcome; and target filesystem accesses. Successful creation using defaults is owner-reported, but does not identify the defaults. The originally configured dates remain 1 January 2026; they are not readback evidence after reopening. No date/period persistence claim is inferred from successful company shutdown/reselection. Initial path/empty-company confirmation applies to that earlier startup check, not the post-creation state.

The owner's detailed follow-up refines the same baseline record: valid inputs **01-02-2026 to 28-02-2026**, invalid inputs **28-02-2026 to 01-02-2026**, successful creation using defaults, and explicit non-verification of reopened values. It confirms, rather than expands, the reported navigation/validation scope. All findings remain **owner-reported evidence**. The accessible inline-error recommendation below remains our proposed implementation requirement, not reference behavior or implemented ERP functionality.

**P1-10 verdict: PASS.** Reported creation, explicit dates, valid/invalid range behavior, restoration and shutdown/reselection satisfy the unchanged baseline actions/results criterion. Individual defaults and retained values remain unverified and must be observed before any design relies on them. Phase 1 reached 100% technically, then the later “Implement phase 2” instruction explicitly closed/approved it. The earlier baseline report alone did not authorize Phase 2.

## Original ERP requirement — accounting-period validation

Requirement **REQ-PERIOD-RANGE-01**, explicitly requested by the owner. Status: **documented for future approved phases; not implemented or tested**. The reference finding above describes an audible-only rejection; the requirements below are our independent design, not a claim about reference behavior.

- If `endDate < startDate`, display a clear inline explanation next to the end-date field. Proposed wording: **“End date must be on or after start date.”** This is proposed ERP copy, not reference error text.
- Visibly highlight the invalid field and provide text so color or sound is not the only signal. Preserve entered values for correction. Prevent saving/applying the invalid period, including through keyboard submission or direct commands.
- Keep correction/submission fully keyboard-operable with visible focus. Associate the inline message with the invalid field and expose invalid state/error announcement to screen readers; verify the error can be found and understood without hearing a warning.
- Enforce the same date-order invariant in the shared domain, return a structured field-associated error, and enforce it again at relevant transactional persistence boundaries. UI validation alone must not permit invalid stored periods or bypass through an API/native command. Adapters enforce the invariant without duplicating core calculations.
- Acceptance evidence in later phases: domain rejection/valid-range cases in Phase 2; relevant SQLite/native constraints and accessible desktop form in Phase 3; cloud API/PostgreSQL enforcement in Phase 4; IndexedDB and accessible browser form in Phase 5. Test failed-save atomicity, keyboard submission, visible inline feedback and screen-reader error association. Exact schema/error codes and UI components are deferred until their approved phases.

No domain code, database constraints, UI components or new dependencies were added to implement this requirement in Phase 1.

## Manual baseline protocol — P1-10

This is the protocol used to request the owner walkthrough; actual reported outcomes and missing details are recorded above. Instructions are not themselves evidence. Successful use of defaults was reported, but individual default values and post-reopening date/period persistence details were not supplied. Future use must retain the same distinction. Existing D: copies are not proven isolated.

1. Identify the test executable/version and confirm a dedicated empty synthetic data location and separate configuration through normal documented controls. Keep it separate from production `Data`, licence records and exports. Do not copy licence files, alter security settings or enable network integration.
2. Start only this confirmed test configuration. Record the visible starting screen, whether any company auto-loads, available company selection/setup actions, and actual navigation path. Stop if real company details appear; do not capture them.
3. Create a company named `Synthetic Reference Lab`, with invented details, a deliberate financial year and books-from date. Record field names/defaults in paraphrase, actions, observed success or validation messages and saved configuration. Do not enable real tax registration, banking or cloud access.
4. Use normal controls to view/change the active company, financial year and report period; record scope indicators, permitted range and persistence after closing/reopening the test company. Try one invalid date/range only within this synthetic context and record the actual response.
5. Close the test company/session normally. Record that production configuration/data were not used; leave synthetic evidence identifiable and recoverable. No cleanup of vendor directories is authorized.

Minimum record: observer/date, exact test target and isolation method, synthetic company/period inputs, ordered user actions, actual visible outcomes, error/result text paraphrases, report/navigation scope, what survived reopening, and limitations. Screenshots are optional, must contain synthetic data only, and remain reference evidence rather than assets for our UI.

Passing P1-10 requires actual observations of company/period navigation with adequate isolation evidence, not just successful launch or this written protocol. If the operator cannot perform it, keep the gate open; do not fabricate a pass or treat elapsed time as approval.

## Reference research and non-blocking observation backlog

### Phase 2 research — owner-directed official sources

Authorization update, 2026-10-25: the owner instructed **“Implement phase 2”**, closing Phase 1 and authorizing Phase 2. On receiving the proposed manual ledger/voucher walkthrough, the owner redirected the investigation to `https://tallysolutions.com/`. This authorizes official-source research as the available alternative for this phase; it does not turn vendor text into observed local runtime behavior. The homepage returned HTTP 403 to the web reader; official `help.tallysolutions.com` pages were accessible. No additional manual ledger/voucher/trial-balance results have been supplied.

REA MCP was rechecked before Phase 2 design: server 6.8.0 responds, no active native target, Windows native UI observation remains `unsupported_host`. Read-only hashing of `C:\Tally.ERP9\tally.exe` still matches `be0ba3120ae514d485a059d5cf07018dd8a67ebcd289dd6e66bd113db6581c54`. No new launch, debugger, production-data access or vendor-code extraction was needed. Existing Phase 1 path/date observations remain owner-reported only.

| Area | VENDOR-DOC finding / source | Independent Phase 2 decision |
| --- | --- | --- |
| Ledger/group workflow | [ERP 9 ledger creation](https://help.tallysolutions.com/docs/te9rel49/02_CREATING_MASTERS_IN_TALLY/01_Accounts_Information/Ledgers_Groups/Creating_a_Ledger.htm) describes Accounts Info → Ledgers, single/multiple creation, classifications, duplicate-name restriction and balances on either side | Original chart uses five explicit account natures, acyclic groups and company-scoped unique names; no copied reserved group catalog or UI |
| Group metadata | [ERP 9 advanced groups](https://help.tallysolutions.com/docs/te9rel49/02_CREATING_MASTERS_IN_TALLY/01_Accounts_Information/Ledgers_Groups/Create_Group_with_advanced_usage.htm) describes configurable group classification/report attributes | Minimal name/parent/nature model; no advanced calculation flags or vendor customization system |
| Journal actions | [ERP 9 journal entry](https://help.tallysolutions.com/docs/te9rel61/Voucher_Entry/Accounting_Vouchers/Creating_a_Journal_Entry.htm) documents Accounting Vouchers → F7, debit/credit ledgers and narration; describes adjustment usage without cash/bank | Our generic balanced journal intentionally permits cash/bank to support independent fixture posting; payment/receipt/transfer intents enforce their own rules. No assumed match to installed 4.93 validations |
| Trial balance | [ERP 9 trial balance](https://help.tallysolutions.com/article/Tally.ERP9/Reports/Display_Financial_Statements/Display_Trial_Balance.htm) documents Display → Trial Balance, period configuration and ledger debit/credit totals | Original exact projections from immutable journals; opening balances must be balanced journals, never a synthetic difference account used to conceal imbalance |
| Reversing journal terminology | [ERP 9 reversing journals](https://help.tallysolutions.com/docs/te9rel66/Voucher_Entry/Optional_Non-Accounting_Vouchers/Reversing_Journals.htm) describes scenario-only temporary entries, not regular-book postings | Our full reversal is a new permanent opposite-side journal linked to its original, required by the owner. This differs deliberately from that named reference feature |
| Backdated restrictions | [ERP 9 company FAQ](https://help.tallysolutions.com/article/faqs/faq/company-faq.html) describes role-related backdated cutoffs | Our explicit versioned period lock and transaction check derive from owner integrity requirements; no claim that this source proves an equivalent vendor locking implementation |

Limitations: the sources span ERP 9 releases 4.9/6.1/6.6 and explain intended behavior, not installed-build runtime validation. No particular ledger defaults, unbalanced-entry warning, permission implementation, storage transaction mechanism or local correction behavior was verified. Pure accounting rules, immutability, idempotency and locks are original owner requirements, independently verified by our tests when implemented. Tax, inventory and commercial UI remain outside Phase 2.

### Missing reference observations — separate from engine defects

| Installed Tally behavior | Observation status | Effect on our implementation |
| --- | --- | --- |
| Ledger/group UI fields, defaults and actual save-time validation | **NOT VERIFIED** locally; available vendor text remains VENDOR-DOC | Original scoped chart/hierarchy rules are specified and tested independently; not a Phase 2 defect |
| Unbalanced journal entry warning/message/navigation | **NOT VERIFIED** | Our engine rejects imbalance through structured validation and tests; no claim that Tally showed that response |
| Actual ledger/trial-balance values for our J1–J5 fixture | **NOT VERIFIED** in Tally | The 1,300 totals and other fixture values are expected/verified results of our own synthetic tests only |
| Permanent correction/reversal UI behavior | **NOT VERIFIED** locally | Our linked immutable full reversal follows the approved original requirement; vendor scenario journals remain a distinct documented concept |
| Financial-period lock controls, permissions and concurrent posting behavior | **NOT VERIFIED** in Tally | Our explicit locks/versions/transactions are independently designed/tested. This does not negate the separately owner-reported date-range warning |
| Individual creation defaults and exact reopened dates/report period | **NOT VERIFIED** | Retain the owner's original configured dates and successful reselection report without inventing readback or default values |

Read-only clarification recheck: REA 6.8.0 responded, no active analysis target or cleanup pending; native UI observation still reports unsupported host. This check did not inspect new reference screens, amounts, transactions or security internals. No manual walkthrough was requested because no remaining Tally-specific ambiguity materially affects a Phase 2 decision.

Phase 2 implementation defect status: no unresolved mandatory failure in the recorded engine tests/type/lint/build/integration checks. The reference gaps above remain open as research coverage, not accounting defects or requirements to imitate proprietary behavior. Future manual research is conditional on a material unresolved decision, not automatic at every module boundary.

Implementation plan after this research: exact money/calendar primitives; company/year/period and original chart contracts; immutable journal/opening/reversal validation; application unit-of-work/idempotency/audit contracts with an explicitly in-memory test adapter; ledger/trial balance projections; adversarial/concurrency/rollback fixtures; real lint/type/build/test checks and documentation. No source or application behavior is copied from the reference.

The remaining table is a list of possible reference questions, not verified UI paths, product rules or automatic implementation blockers. Use REA where supported and useful; ask for a manual fallback only when a specific unresolved item materially affects an architectural/functional decision. Independent financial tests remain the acceptance basis for standard bookkeeping.

| Phase / area | Controlled synthetic observation to collect | Independent requirements we will evaluate |
| --- | --- | --- |
| 1 — Company/period baseline | Baseline completed through owner report; defaults and exact dates/period after reselection remain unverified | Visible scope, explicit date-range feedback; no invented persistence/default claims |
| 2 — Accounts | Create group/ledger, openings, duplicate names, hierarchy changes | Original chart model, cycle protection, balanced opening journal |
| 2 — Journals/vouchers | Payment/receipt/transfer/general entry, balance errors, date bounds, reversal/alter behavior | Shared balanced immutable posting model; no copying vendor edit semantics |
| 2 — Ledger/trial balance | Enter small known journals; view period totals/drill-through; reconcile independently | Exact projections and audit links |
| 3 — Offline/backup | Normal close/reopen and documented synthetic backup/restore | Our transactional storage/recovery tests; do not damage vendor stores to test crashes |
| 4 — Multi-user/security | Documented roles and authorized synthetic multi-user controls if available | Our tenant/auth/sync design, not inference about vendor internals |
| 6 — Sales/purchases | Service invoice, receipt, partial payment, return/note and allocation | Atomic document posting and subledger reconciliation |
| 7 — Inventory | Item/unit/warehouse, receipt/issue/transfer/return, valuation reports | Deterministic quantities/costs and journal integration |
| 8 — Reports | P&L, balance sheet, cash flow, aging and export on hand-worked fixture | Original report layouts and independently validated Uganda rules |

## Translation into our design

PROPOSED requirements: explicit tenant/company/year selection, quick keyboard entry, clear validation, discoverable drill-through and explicit local/cloud status. These derive from owner goals and general accounting needs; the historical reference report is context only. Our domain, schema, layouts, components and branding are independently proposed in [architecture](../architecture/overview.md) and [accounting](../accounting/accounting-engine.md). No vendor-specific account grouping, shortcut map, source code, UI assets or proprietary implementation has been adopted.
