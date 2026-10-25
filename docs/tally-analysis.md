# Tally.ERP 9 — Functional Analysis

> Historical pre-existing report retained for context. Its `[V]`/`[M]` labels and methodology statements were not independently reproduced in the current Phase 1 pass. The source manual and original tool transcripts were not present in this workspace. See [current research](research/tally-workflows.md) for fresh evidence and limitations. Current REA metadata identifies the selected executable as PE32+ x86-64, superseding this report's Win32 description. Roadmap references below describe the superseded plan and grant no phase approval. Customer usage, tax registration, priorities and licensing assertions below are not current verified requirements.

Purpose: understand what Tally.ERP 9 does, so an original web-based accounting ERP can be designed. This document describes **behaviour and workflows only**. No Tally source code, TDL source, licence data, credentials or company data was extracted or read.

Analysis date: 2026-10-25 · Analyst tooling: REA 6.8.0 (MCP + CLI), Windows built-ins.

## Evidence labels

| Label | Meaning |
|---|---|
| **[V]** | Verified on this machine by read-only static inspection (file metadata, PE headers, config key names). |
| **[M]** | Documented in Tally's own bundled reference manual (`tallyerp9ref.chm`). Describes intended behaviour; not yet observed in the running application. |
| **[A]** | Assumption or general domain knowledge. Must be confirmed with a test company before it drives a design decision. |

## 1. Scope and rules followed

- Read-only. Nothing in any Tally folder was modified, executed, or moved. The help manual was copied to a scratch folder before being opened.
- Not read: the `Data\` folders, `tally.lic`, `TallyLic.ini`, crash dumps (`*.dmp`), logs, or any of the user's spreadsheet/PDF exports stored beside the program.
- `Tally.ini` was read for **key names only**; values were suppressed except integration-port flags (which were empty).
- No licensing, encryption (TallyVault) or security control was inspected or bypassed.
- **Not yet done:** observing the running application with a synthetic test company. Every workflow section below is therefore [M] or [A] until that pass happens (see §9).

## 2. Installations found [V]

| Path | `tally.exe` | Notes |
|---|---|---|
| `C:\Tally.ERP9` | 1.0.4.93, built 2015-03-27 | **Live production install** — has `Data\` and many business exports. Used for static analysis only. |
| `D:\Tally.ERP9` | 1.0.4.93 | Same build. |
| `D:\Tally.ERP9 2` | 1.0.4.93 | Same build. |
| `D:\TALLY.ERP` | — | Data only, no program. |
| `E:\Tally.ERP9` | — | Registered in Windows uninstall entry, but path does not exist. |

Release: Tally.ERP 9 **Series A** (per manual title). All three program copies are the same build.

## 3. Architecture [V unless marked]

```
tally.exe  (native Win32 GUI, single executable, ~7 MB)
  ├── tdlserver.dll  — TDL engine: loads/validates the definition language
  ├── tallywin.dat / tallywin32.dat — packaged default definitions [A]
  ├── stat.900       — statutory/tax module (India: GST/VAT/TDS etc.) [A]
  ├── Lang\*.dct     — UI dictionaries for 15 languages + Rupakara fonts
  ├── tallylicserver.exe / TallyLicUI.dll — licensing (not inspected)
  ├── TallyAdmin.exe, regodbc32.exe, tally72migration.exe, lockconverter.exe
  └── Data\<company number>\ — company databases (not inspected)
```

Key observations:

1. **Definition-driven UI.** `tdlserver.dll` exports `TS_LoadBaseTDL`, `TS_LoadDefaultTDL`, `TS_GetSchemaTDLBuffer`, `TS_LoadTDLByFileName`, `TS_Validate`, `TS_SetUDFValidateRange`, `TS_ArchiveToBin`. Screens, reports and the data schema are described in Tally Definition Language (TDL) and interpreted at runtime; user-defined fields (UDFs) are supported. *Design takeaway:* Tally's strength is configurability — reports and forms are data, not hard-coded screens.
2. **Integration surface.** `tally.exe` imports `odbc32.dll` (ODBC), `ws2_32.dll` (sockets — the XML-over-HTTP server [M]), `wininet.dll` (Tally.NET / updates [A]), `crypt32.dll`, `netapi32.dll`, `mpr.dll` (network drives / multi-user).
3. **Integration server disabled here.** `Tally.ini` keys `ServerPort`, `Enable ODBC Server`, `Client Server` are present but empty. Other keys present: `Data`, `Default Companies`, `Load`, `Auto Backup Path`, `User TDL`, `TDL`, `Export Path`, `LangPath`.
4. **Storage.** Proprietary file-based company store, one folder per company number [M]. Not inspected.
5. **Statutory module is India-specific** (`stat.900`, manual sections on GST/TDS/PF/ESI). The business appears to operate in Uganda [A, inferred from export filenames only], so **none of Tally's statutory logic is reusable** — Ugandan tax rules must be designed independently.

### Analysis methods available / not available

| Method | Status |
|---|---|
| PE import/export/resource inspection (REA) | Used. Results above. |
| Native decompilation (Hopper/Ghidra/IDA) | **Deliberately not used** — out of scope (would expose proprietary code). |
| `inspect_binary_layout` | Not available on Windows (Linux-only provider). |
| UI automation of the running app | Not supported by REA on Windows. Workflows must be observed manually (screenshots / walkthrough). |
| XML/ODBC export from a **test** company | Possible later if you enable the server on a test install — gives exact field lists. Optional. |

## 4. Feature inventory [M]

From the manual's table of contents (31 top-level sections). Relevant areas:

- **Company:** create / alter / delete / shut / load; group companies (consolidation); F11 Company Features (accounting, inventory, statutory, audit); F12 Configuration (voucher entry, invoice/orders, printing, e-mail, banking).
- **Masters:** Groups, Ledgers, Voucher Types, Currencies, Cost Categories/Centres, Budgets, Scenarios; Stock Groups, Stock Categories, Stock Items, Units, Godowns (locations), Batches & Expiry, Bills of Materials, Price Levels/Lists.
- **Accounting vouchers:** Contra, Payment, Receipt, Journal, Sales, Purchase, Debit Note, Credit Note.
- **Inventory vouchers:** Receipt Note (GRN), Delivery Note, Rejections In/Out, Stock Journal, Physical Stock, Material In/Out.
- **Non-accounting:** Memorandum, Optional, Reversing Journal, Post-dated vouchers.
- **Orders:** Purchase Order, Sales Order, Job Order, order position, pre-closure.
- **Advanced:** multi-currency, interest calculation, credit limits, cheque printing, POS, job costing, reorder levels, additional cost of purchase, batch/expiry tracking.
- **Banking:** bank reconciliation (manual/auto), cheque register, deposit slips, payment advice.
- **Reports:** Balance Sheet, P&L, Trial Balance, Receipts & Payments, Cash Flow, Funds Flow, Ratio Analysis; Day Book, Cash/Bank Book, Sales/Purchase/Journal registers, Ledger statements; Receivables/Payables (outstanding, ageing), reminder letters, confirmation statements; Stock Summary, Movement Analysis, Ageing, Godown/Batch reports, Order books, Pending bills.
- **Payroll:** employees, pay heads, salary structures, attendance, payroll vouchers, pay slips, statutory payments.
- **Admin:** users & passwords, voucher-type security, audit trail of edits ("Tally Audit"), backup/restore, split company by year, export/import (XML), e-mail reports, TallyVault encryption.

**Usage signal [A]:** filenames of exports saved next to the program (contents not opened) suggest this business mainly uses: Day Book, debtors/receivables lists, expense reports by group, group summaries, trial balance, P&L, voucher printouts, statements of account, and payroll (pay sheet / pay slip). Inventory and orders appear little used. This drives the roadmap priorities.

## 5. Core accounting model

### 5.1 Chart of accounts [M]

Tally ships **28 reserved groups: 15 primary, 13 sub-groups**. Every ledger must sit under a group; the group's nature decides whether balances flow to the Balance Sheet or P&L.

| Primary group | Nature | Reserved sub-groups |
|---|---|---|
| Capital Account | Liability | Reserves & Surplus |
| Loans (Liability) | Liability | Bank OD A/c, Secured Loans, Unsecured Loans |
| Current Liabilities | Liability | Duties & Taxes, Provisions, Sundry Creditors |
| Fixed Assets | Asset | — |
| Investments | Asset | — |
| Current Assets | Asset | Bank Accounts, Cash-in-Hand, Deposits (Asset), Loans & Advances (Asset), Stock-in-Hand, Sundry Debtors |
| Branch / Divisions | Liability | — |
| Misc. Expenses (Asset) | Asset | — |
| Suspense A/c | Liability | — |
| Sales Accounts | Income (direct) | — |
| Purchase Accounts | Expense (direct) | — |
| Direct Incomes | Income | — |
| Indirect Incomes | Income | — |
| Direct Expenses | Expense | — |
| Indirect Expenses | Expense | — |

Rules:
- [M] Cash-in-Hand and Bank ledgers are reported as Cash/Bank Books.
- [M] Bill-wise tracking is only available for ledgers under Sundry Debtors / Sundry Creditors (configurable for others).
- [M] Stock-in-Hand behaviour depends on whether accounts and inventory are integrated.
- [A] Direct vs indirect split determines Gross Profit (trading account) vs Net Profit.
- [A] Users may create unlimited sub-groups, nested arbitrarily, and rename reserved groups but not delete them.

### 5.2 Ledger [A — confirm with test company]

Name, alias, parent group, opening balance (Dr/Cr), bill-wise on/off, credit period, credit limit, cost-centre applicability, interest settings, address/contact/tax-ID (for parties), bank details (for bank ledgers), currency.

### 5.3 Voucher (transaction) rules

| Voucher | Purpose | Typical constraint |
|---|---|---|
| Contra | Cash↔Bank, Bank↔Bank | [A] Only cash/bank ledgers allowed |
| Payment | Money out | [A] Credit side must be cash/bank |
| Receipt | Money in | [A] Debit side must be cash/bank |
| Journal | Adjustments | [A] Normally excludes cash/bank |
| Sales / Purchase | Invoices | [M] Can be in "invoice mode" (item lines + tax) or "voucher mode" |
| Debit / Credit Note | Returns, price corrections | [M] Must be enabled in F11 |

Universal rules:
- [A] Double entry: total debits = total credits per voucher, or it cannot be saved.
- [A] Each voucher has: type, number (auto/manual per voucher type), date (inside the financial year, after "books beginning from"), narration, and one or more ledger lines.
- [M] User-defined voucher types inherit behaviour from a parent predefined type (e.g. "Cash Sales" → Sales) with their own numbering and print settings.
- [M] Optional vouchers do not affect books until regularised; memorandum vouchers never do; post-dated vouchers post on their date.
- [M] Bill-wise allocation on party lines: **New Ref**, **Agst Ref**, **Advance**, **On Account**. This is how receivables/payables ageing works.
- [M] Cost-centre allocation on income/expense lines.
- [M] Edits and deletions are logged when Tally Audit is enabled.

### 5.4 Inventory [M, low priority]

Stock items under stock groups/categories, with units (simple and compound), godowns, batches, BOM. Inventory vouchers move quantity; invoice-mode Sales/Purchase move both quantity and value. [A] Valuation methods (average cost, FIFO, etc.) are set per item; closing stock value feeds the Balance Sheet/P&L when integrated.

## 6. Workflows to document (observation needed)

Each entry below records the intended flow [M/A] and what to capture in the observation pass.

| # | Workflow | Expected path [M/A] | Capture during observation |
|---|---|---|---|
| W1 | Create company | Gateway → Alt+F3 Company Info → Create → name, address, country, currency, FY start, books-from, (TallyVault) | Every field, defaults, validation messages |
| W2 | Configure features | F11 Accounting / Inventory features | Which toggles exist, what each unlocks |
| W3 | Groups & ledgers | Gateway → Accounts Info → Groups / Ledgers → Create / Display / Alter (single and multiple) | Ledger fields per group type; opening balances |
| W4 | Voucher types | Accounts Info → Voucher Types | Numbering options, print options |
| W5 | Payment / Receipt / Contra / Journal | Gateway → Accounting Vouchers → F4–F7 (Contra F4, Payment F5, Receipt F6, Journal F7) | Dr/Cr entry style ("By/To"), bill-wise popup, narration |
| W6 | Sales & Purchase | F8 Sales / F9 Purchase, invoice vs voucher mode | Line layout, tax lines, party popups, print layout |
| W7 | Debit/Credit notes | Ctrl+F9 / Ctrl+F8 | Linking to original invoice |
| W8 | Receivables & payables | Display → Statements of Accounts → Outstandings | Ageing buckets, drill-down, reminder letters |
| W9 | Day Book, Cash/Bank Book, Ledger | Display → Day Book / Account Books | Filters, period change (F2), drill-down (Enter), alter-from-report |
| W10 | Trial Balance, P&L, Balance Sheet | Gateway → Balance Sheet / P&L / Trial Balance | Detailed vs condensed (Alt+F1), comparative columns, period |
| W11 | Bank reconciliation | Bank ledger → F5 Reconcile | Fields, matching flow |
| W12 | Inventory & orders | Inventory Info / Inventory vouchers | Only if you confirm you use them |
| W13 | Payroll | Payroll Info → Employees, Pay Heads, Salary Details; Payroll voucher | Pay head types, calculation types, pay slip |
| W14 | Security & backup | Users/passwords; Backup (Alt+F3) | Roles, voucher-type restrictions |

### UI behaviour patterns [A — characteristic of Tally, confirm]

- Keyboard-first: every action has a function key / Alt / Ctrl shortcut; mouse optional.
- "Gateway of Tally" single menu hub; hierarchical drill-down with **Enter** to go in and **Esc** to go back.
- Every report line drills down to the voucher; vouchers editable from reports (Alt+A add, Alt+X cancel, Alt+D delete).
- Type-ahead "list of ledgers" pop-ups with create-on-the-fly (Alt+C).
- Period change (F2) and company change (F3) available on every screen.
- Reports configurable on screen (F12) and switchable condensed/detailed (Alt+F1).
- Ctrl+A to accept a form; Y/N confirmation on save.

These patterns — speed of data entry and drill-down — are the main things accountants value in Tally and the main things a web clone usually gets wrong.

## 7. Features suitable for independent implementation

| Area | Implement? | Notes |
|---|---|---|
| Multi-company, financial years, books-from date | Yes (P1) | Standard. |
| Chart of accounts with 15 primary groups & nesting | Yes (P1) | The grouping concept is generic accounting; use our own names/defaults (IFRS-friendly). |
| Ledgers with opening balances, party details | Yes (P1) | |
| Voucher engine (8 base types + custom types, numbering) | Yes (P1) | Core of the product. |
| Bill-wise receivables/payables, ageing | Yes (P2) | High value for this business. |
| Day Book, ledgers, cash/bank books, registers | Yes (P2) | |
| Trial Balance, P&L, Balance Sheet, Cash Flow | Yes (P2) | |
| Cost centres, budgets | Yes (P3) | |
| Bank reconciliation, cheque register | Yes (P3) | |
| Multi-currency (UGX base + USD) | Yes (P3) | |
| Payroll for Uganda (PAYE, NSSF, LST) | Yes (P4) | Must be built from URA/NSSF rules, not from Tally's Indian payroll. |
| Uganda VAT/WHT + URA EFRIS e-invoicing | Yes (P4) | Requires your accountant's confirmation of obligations. |
| Inventory, godowns, BOM, orders | Optional (P5) | Only if confirmed needed. |
| Import from Tally (XML export of a company) | Yes (P5) | Useful for migration; uses Tally's documented export, not its file format. |
| Audit trail of edits, users/roles | Yes (P1 basic, P3 full) | |
| TDL-style user customisation language | **No** | Replace with configurable report columns/filters and custom fields. |
| Tally.NET, SMS, licensing, TallyVault | **No** | Not relevant to a web app; use standard auth + encryption at rest. |
| India statutory (GST, TDS, PF, ESI, XBRL) | **No** | Not applicable. |
| Copying Tally's exact screens, names, icons, help text | **No** | Design our own UI; keep only generic accounting concepts and keyboard-first ergonomics. |

## 8. Legal / IP notes

- Accounting concepts (double entry, group hierarchy, voucher types, ageing) are generic and not proprietary.
- Do not copy Tally's help text, screen layouts, report formats, TDL or branding. Our documents paraphrase.
- Migration should use Tally's own documented export (XML/Excel) from data you own.

## 9. Open items / next observation pass

1. Create a **test company** with synthetic data in a fresh data folder (e.g. `C:\TallyTest`) — never the production `Data\`.
2. Walk W1–W11 (and W13 if payroll is used) with screenshots; update each [A]/[M] item to [V] or correct it.
3. Confirm country, base currency (UGX?), tax registrations (VAT, WHT, PAYE/NSSF), and whether EFRIS is required.
4. Confirm whether inventory/orders are used at all.
5. Optional: enable the XML server on a **test** install only, export the test company to XML to confirm field lists.
