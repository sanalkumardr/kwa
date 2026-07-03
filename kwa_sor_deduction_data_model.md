# KWA Pipeline Works — SOR & Deduction Data Model

Fills the two highest-risk gaps in the spec: **Schedule of Rates (SOR) versioning** and a **statutory deduction rules engine**. Designed for PostgreSQL + PostGIS, offline-first compatible (every table carries the sync envelope), and audit-grade (effective-dated, append-only where it matters, no hard deletes).

---

## 1. Why this matters

Every rupee a government bill pays out must trace to a measured quantity × a *defensible rate*, minus *statutory deductions computed by rule*. Auditors (AG/CAG) challenge two things constantly: "was this the correct SOR rate in force for this agreement?" and "were deductions applied at the legally correct rate for the bill date?" Hard-coding rates or deductions fails both tests. The model below makes each answer a lookup with a paper trail.

---

## 2. Core principle: editions, not just values

- An **SOR edition** is a published rate book (e.g., "KWA SOR 2025-26"). A project locks to one edition at agreement time; later editions do not retroactively change that project's rates.
- A **deduction scheme** is a versioned set of rules effective over a date range. A bill is computed against whichever rules were in force on the bill's reference date.
- Both are **effective-dated** and **never edited in place** — a correction creates a new version, preserving history.

---

## 3. SOR tables

### `sor_edition`
The published rate book.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| code | text | e.g., `KWA-2025-26` |
| title | text | |
| authority | text | KWA / PWD / CPWD |
| effective_from | date | |
| effective_to | date null | null = current |
| status | text | draft / published / superseded |
| published_by | uuid → user | |
| created_at, updated_at, deleted, synced, created_by | sync envelope | |

### `sor_item`
A single rate line within an edition.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| edition_id | uuid → sor_edition | |
| item_code | text | SOR code, e.g., `WS-12.4` |
| description | text | |
| unit | text | m, m³, no., kg |
| base_rate | numeric(14,2) | rate in this edition |
| chapter | text | grouping (earthwork, pipe laying…) |
| is_active | boolean | |
| sync envelope | | |

*Unique:* `(edition_id, item_code)`.

### `project_sor_binding`
Locks a project (and optionally a tender) to one edition.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| project_id | uuid → project | |
| edition_id | uuid → sor_edition | the edition fixed at agreement |
| tender_premium_pct | numeric(6,3) | contractor's quoted above/below SOR, e.g., +4.500 / -2.000 |
| bound_at | date | |
| sync envelope | | |

> **Effective rate for a bill line = `sor_item.base_rate` × (1 + `tender_premium_pct`/100)**, plus any approved escalation (below).

### `extra_item`
Non-SOR / "extra" or "substitute" items requiring rate analysis and approval.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| project_id | uuid → project | |
| description | text | |
| unit | text | |
| derived_rate | numeric(14,2) | from rate analysis |
| basis | text | how rate was derived |
| status | text | proposed / approved / rejected |
| approved_by | uuid → user null | EE-level |
| approved_at | timestamptz null | |
| sync envelope | | |

### `rate_escalation` (optional, Phase 3+)
Price-adjustment clauses for long projects.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| project_id | uuid → project | |
| period | daterange | |
| index_name | text | e.g., steel/cement index |
| factor | numeric(8,4) | multiplier applied |
| approved_by | uuid → user | |
| sync envelope | | |

---

## 4. Deduction rules engine

### `deduction_type`
The catalogue of deduction kinds.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| code | text | `IT`, `GST_TDS`, `SD`, `LABOUR_CESS` |
| name | text | |
| direction | text | recoverable (security) vs statutory (tax) |
| refundable | boolean | security deposit refunds after DLP |
| sync envelope | | |

### `deduction_scheme`
A versioned set of rules effective over a window.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| code | text | e.g., `STATUTORY-2025` |
| effective_from | date | |
| effective_to | date null | |
| status | text | draft / active / superseded |
| sync envelope | | |

### `deduction_rule`
One computed rule inside a scheme.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| scheme_id | uuid → deduction_scheme | |
| type_id | uuid → deduction_type | |
| basis | text | `gross` / `taxable` / `pre_tax_value` |
| rate_pct | numeric(7,4) | e.g., 2.0000 for 2% IT |
| threshold_amount | numeric(14,2) null | apply only above this value |
| cap_amount | numeric(14,2) null | optional ceiling |
| calc_order | int | sequence (some deductions stack) |
| rounding | text | nearest / up / down |
| sync envelope | | |

> A bill engine selects the **active scheme for the bill's reference date**, iterates its rules by `calc_order`, applies `rate_pct` to the chosen `basis` (respecting threshold/cap), and writes one `bill_deduction` row per rule for full traceability.

### `bill_deduction`
The applied result, stored per bill (append-only).

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| bill_id | uuid → bill | |
| rule_id | uuid → deduction_rule | which rule produced this |
| type_code | text | snapshot (rules may later change) |
| basis_amount | numeric(14,2) | |
| rate_pct | numeric(7,4) | snapshot |
| amount | numeric(14,2) | computed deduction |
| created_at | timestamptz | |
| sync envelope | | |

Snapshotting `type_code`/`rate_pct` onto the bill line means a later scheme revision can never silently alter a historical bill.

---

## 5. How a bill computes (worked flow)

1. Bill references approved MB entries → each line gets `quantity × effective_rate` (SOR base × tender premium, or extra-item/escalated rate).
2. Sum → **gross_amount**.
3. Load active `deduction_scheme` for `bill.reference_date`.
4. For each `deduction_rule` in `calc_order`: compute `amount`, write a `bill_deduction` row.
5. **net_payable = gross_amount − Σ(bill_deduction.amount)**.
6. Lock the bill on certification; `bill_deduction` rows become immutable.

This gives auditors a complete chain: payment → bill → each deduction rule + rate snapshot → MB entry → SOR edition + premium → measured quantity + GPS/photo.

---

## 6. Sync & integrity notes

- All tables carry the envelope: `id, synced, updated_at, deleted, created_by`.
- **SOR editions and deduction schemes are server-authoritative** (admin-published) — field devices pull, never push, these. This avoids offline conflicts on rate data entirely.
- `bill_deduction`, `mb_entry`, and approved bills are **append-only / lock-after-approval** — no last-write-wins.
- Corrections happen by issuing a new version (new scheme, new extra-item rate), never by editing a locked record.
