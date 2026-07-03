# KWA Pipeline Works — Core Data Model

The remaining core tables that connect to the SOR/deduction model (`kwa_sor_deduction_data_model.md`). Target: PostgreSQL 15+ with PostGIS. Offline-first (sync envelope on every table) and audit-grade (no hard deletes, financial records append-only/lock-after-approval).

---

## Conventions

**Sync envelope** — every table carries these columns (abbreviated as *“+ envelope”* below):

```
id           uuid primary key default gen_random_uuid()
created_by   uuid references app_user(id)
created_at   timestamptz not null default now()
updated_at   timestamptz not null default now()
deleted      boolean not null default false      -- soft delete only
synced       boolean not null default false      -- device sync flag
```

**Money** = `numeric(14,2)`. **Percent** = `numeric(7,4)`. **Geometry** uses PostGIS SRID 4326.

---

## Entity map (how it all connects)

```
app_user ──< user_scope >── org_unit (Section→Subdiv→Division→Circle)
   │
project ──1:1── project_sor_binding ──> sor_edition ──< sor_item
   │
   ├──< tender ──> contractor
   ├──< pipeline_segment (PostGIS linestring + chainage)
   ├──< milestone
   │        │
   │        └──< mb_entry ──> sor_item / extra_item     [lock-after-approval]
   │                  │
   ├──< dpr           └──< bill_line >── bill ──< bill_deduction ──> deduction_rule
   │                                       │
   │                                       └──< payment
   ├──< quality_test
   ├──< issue (PostGIS point)
   └──< document

audit_log  — immutable, references any entity
```

---

## 1. Organisation & access

### `org_unit`
The KWA hierarchy (self-referencing tree).

| Column | Type | Notes |
|---|---|---|
| name | text | |
| level | text | section / subdivision / division / circle / authority |
| parent_id | uuid → org_unit null | null at authority root |
| code | text | |
| + envelope | | |

### `app_user`

| Column | Type | Notes |
|---|---|---|
| name | text | |
| phone | text | OTP login |
| role | text | contractor / overseer / ae / aee / ee / admin |
| home_unit_id | uuid → org_unit | primary posting |
| device_id | text null | for approval-tier device binding |
| + envelope | | |

### `user_scope`
Grants a user visibility/action over an org subtree. (A user may hold more than one.)

| Column | Type | Notes |
|---|---|---|
| user_id | uuid → app_user | |
| org_unit_id | uuid → org_unit | sees this node + descendants |
| + envelope | | |

> **RLS pattern:** a project is visible to a user if `project.org_unit_id` is within any of the user's `user_scope` subtrees. Enforce in PostgreSQL row-level security, not just the UI.

---

## 2. Project & sanction

### `project`

| Column | Type | Notes |
|---|---|---|
| name | text | |
| scheme | text | funding scheme |
| sanction_no | text | |
| sanction_amount | money | |
| sanctioning_authority | text | |
| as_date | date | Administrative Sanction |
| ts_date | date | Technical Sanction |
| org_unit_id | uuid → org_unit | owning division/sub-division — drives scope |
| status | text | sanctioned / tendered / in_progress / completed / archived |
| archived_at | timestamptz null | set at close-out (read-only thereafter) |
| + envelope | | |

Links 1:1 to `project_sor_binding` (in the SOR model) which fixes the SOR edition + tender premium.

---

## 3. Tender / agreement

### `contractor`

| Column | Type | Notes |
|---|---|---|
| name | text | |
| gstin | text | |
| pan | text | |
| + envelope | | |

### `tender`

| Column | Type | Notes |
|---|---|---|
| project_id | uuid → project | |
| tender_no | text | |
| contractor_id | uuid → contractor | |
| agreement_value | money | |
| work_order_date | date | |
| completion_due_date | date | |
| emd | money | earnest money deposit |
| security_deposit | money | |
| defect_liability_until | date | DLP expiry — gates SD refund |
| + envelope | | |

---

## 4. Pipeline / GIS (the spine)

### `pipeline_segment`
A reach of the route as real geometry, not lat/lng points.

| Column | Type | Notes |
|---|---|---|
| project_id | uuid → project | |
| name | text | reach label |
| geom | geometry(LineStringZ, 4326) | PostGIS — enables chainage math |
| chainage_from | numeric(10,3) | km, e.g., 0.000 |
| chainage_to | numeric(10,3) | e.g., 12.450 |
| diameter_mm | int | |
| material | text | DI / HDPE / PVC |
| depth_m | numeric(6,2) | |
| jointing | text | |
| status | text | planned / in_progress / laid / tested |
| + envelope | | |

> Use PostGIS `ST_LineLocatePoint` / `ST_LineSubstring` for "distance along line" so GPS points map to chainage, and planned-vs-actual length is a spatial query, not manual bookkeeping.

---

## 5. Milestones

### `milestone`

| Column | Type | Notes |
|---|---|---|
| project_id | uuid → project | |
| name | text | |
| chainage_from | numeric(10,3) | |
| chainage_to | numeric(10,3) | |
| planned_qty | numeric(14,3) | |
| unit | text | |
| planned_date | date | |
| payment_percent | percent | share of value released on completion |
| depends_on | uuid → milestone null | dependency for sequencing |
| status | text | not_started / in_progress / done / at_risk |
| + envelope | | |

> Surface the **next at-risk milestone** by comparing measured progress vs `planned_date`/`planned_qty`.

---

## 6. Measurement Book — the legal heart

### `mb_entry`
Append-only; **locks on approval** (no edits, no last-write-wins).

| Column | Type | Notes |
|---|---|---|
| project_id | uuid → project | |
| milestone_id | uuid → milestone | |
| sor_item_id | uuid → sor_item null | one of SOR or extra item |
| extra_item_id | uuid → extra_item null | |
| chainage_from | numeric(10,3) | |
| chainage_to | numeric(10,3) | |
| quantity | numeric(14,3) | |
| unit | text | |
| rate_snapshot | money | effective rate at entry (base × premium / extra / escalated) |
| amount | money | quantity × rate_snapshot |
| gps | geometry(Point, 4326) | where measured |
| photos | jsonb | array of storage keys |
| measured_by | uuid → app_user | overseer/site engineer |
| checked_by | uuid → app_user null | AE |
| approved_by | uuid → app_user null | AEE |
| locked_flag | boolean default false | true once approved → immutable |
| approved_at | timestamptz null | |
| + envelope | | |

*Check constraint:* exactly one of `sor_item_id` / `extra_item_id` is set. Once `locked_flag = true`, application + DB rule reject any UPDATE except the audit trail.

---

## 7. Daily Progress Report

### `dpr`

| Column | Type | Notes |
|---|---|---|
| project_id | uuid → project | |
| report_date | date | |
| weather | text | |
| manpower | jsonb | by trade |
| machinery | jsonb | |
| length_laid_today_m | numeric(10,2) | |
| chainage_reached | numeric(10,3) | |
| work_done | text | |
| work_planned | text | |
| photos | jsonb | GPS-tagged keys |
| blockers | text | |
| status | text | draft / submitted / approved |
| approved_by | uuid → app_user null | AE |
| + envelope | | |

Operational entity → server-wins conflict policy is fine here.

---

## 8. Bills & payment

### `bill`
Append-only after certification; snapshots rates.

| Column | Type | Notes |
|---|---|---|
| project_id | uuid → project | |
| running_bill_no | int | sequential per project |
| reference_date | date | drives which deduction scheme applies |
| gross_amount | money | Σ bill_line.amount |
| total_deductions | money | Σ bill_deduction.amount |
| net_payable | money | gross − deductions |
| certified_by | uuid → app_user null | AEE |
| status | text | draft / certified / paid |
| certified_at | timestamptz null | locks the bill |
| + envelope | | |

### `bill_line`
Pulls approved MB entries into a bill.

| Column | Type | Notes |
|---|---|---|
| bill_id | uuid → bill | |
| mb_entry_id | uuid → mb_entry | must be locked/approved |
| quantity | numeric(14,3) | snapshot |
| rate | money | snapshot |
| amount | money | |
| + envelope | | |

`bill_deduction` lives in the deduction model — one row per applied rule, snapshotting `type_code`/`rate_pct`.

### `payment`

| Column | Type | Notes |
|---|---|---|
| bill_id | uuid → bill | |
| amount | money | net released |
| sanctioned_by | uuid → app_user | EE |
| payment_date | date | |
| reference | text | PFMS/transaction ref |
| + envelope | | |

---

## 9. Quality, issues, documents

### `quality_test`

| Column | Type | Notes |
|---|---|---|
| project_id | uuid → project | |
| pipeline_segment_id | uuid → pipeline_segment null | |
| test_type | text | hydro / pressure / compaction / material |
| result | text | pass / fail |
| value | text | reading / certificate ref |
| tested_at | date | |
| qc_by | uuid → app_user | |
| + envelope | | |

### `issue`

| Column | Type | Notes |
|---|---|---|
| project_id | uuid → project | |
| location | geometry(Point, 4326) | GPS-pinned |
| title | text | |
| priority | text | low / med / high |
| assignee_id | uuid → app_user null | |
| due_date | date null | |
| status | text | open / in_progress / resolved |
| photos | jsonb | |
| + envelope | | |

### `document`

| Column | Type | Notes |
|---|---|---|
| project_id | uuid → project | |
| kind | text | drawing / permit / agreement / mb_scan / noc |
| version | int | drawings are versioned |
| storage_key | text | S3 object |
| expires_on | date null | permits → expiry alerts |
| + envelope | | |

---

## 10. Audit log (immutable)

### `audit_log`

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| entity_table | text | which table |
| entity_id | uuid | which row |
| action | text | create / update / approve / lock / soft_delete |
| actor_id | uuid → app_user | |
| at | timestamptz default now() | |
| before | jsonb null | prior state |
| after | jsonb null | new state |

Insert-only (no update/delete). Written by DB triggers on every mutating action so the trail cannot be bypassed by the app.

---

## Traceability check (the AG/CAG chain)

Every payment resolves backward with no gaps:

```
payment → bill → bill_line → mb_entry (locked, GPS+photo)
                              → sor_item (within fixed sor_edition) × tender_premium
        → bill_deduction → deduction_rule (within dated scheme), rate snapshotted
mb_entry → milestone → project → org_unit (scope) → sanction
every step → audit_log (who/what/when, before/after)
```

If any link is missing, the bill cannot be certified — which is exactly the property that earns officer and auditor trust.
