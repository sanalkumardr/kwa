# KWA Pipeline Works — Database Migrations

Numbered, ordered SQL migrations for the KWA pipeline-tracking schema. Apply in sequence against PostgreSQL 15+ with PostGIS 3.x.

## Files

| # | File | Purpose | Environments |
|---|---|---|---|
| 001 | `001_schema.sql` | Tables, constraints, indexes, triggers (soft-delete, lock-after-approval, audit), RLS helpers | all |
| 002 | `002_rls.sql` | Row-level security policies on every project-scoped table | all |
| 003 | `003_seed_demo.sql` | Reference + demo data and a worked bill computation | **dev/demo only** |
| 004 | `004_chainage.sql` | PostGIS chainage functions (point→chainage, planned/laid km) | all |
| 005 | `005_auth_dpr_gps.sql` | OTP table + DPR gps/chainage/segment columns | all |

> Do **not** run `003` in production — it inserts sample org units, users, and a project. In production, seed real reference data (SOR editions, deduction schemes) separately.

## Prerequisites

- PostgreSQL 15 or newer.
- Extensions `postgis` and `pgcrypto` (created by `001`; the running role must be permitted to `CREATE EXTENSION`, or have a superuser create them first).
- A database to apply them to, e.g. `kwa`.

## Apply

```bash
# create the database once
createdb kwa

# apply in order
psql -d kwa -v ON_ERROR_STOP=1 -f 001_schema.sql
psql -d kwa -v ON_ERROR_STOP=1 -f 002_rls.sql

# dev/demo only
psql -d kwa -v ON_ERROR_STOP=1 -f 003_seed_demo.sql

# GIS chainage functions
psql -d kwa -v ON_ERROR_STOP=1 -f 004_chainage.sql

# auth (OTP) + DPR location columns
psql -d kwa -v ON_ERROR_STOP=1 -f 005_auth_dpr_gps.sql
```

`ON_ERROR_STOP=1` ensures a failed statement aborts the run rather than continuing.

## Application contract (important)

Every request/connection must identify the acting user **before** running queries, so that row-level security and the audit log work:

```sql
SET kwa.current_user_id = '<app_user uuid>';
```

- RLS uses it to scope visible projects to the user's org subtree.
- The audit triggers record it as the actor on every create/update.

If unset, RLS-protected tables return no rows and audit entries have a null actor.

## What the schema guarantees

- **Soft delete only** — hard `DELETE` is blocked on all domain tables; set `deleted = true`.
- **Lock-after-approval** — an MB entry locks when `approved_by` is set; a bill locks when `certified_by` is set. Locked rows are immutable.
- **Immutable audit trail** — `audit_log` is insert-only and written by triggers (before/after JSON).
- **Computed money** — `mb_entry.amount`, `bill_line.amount`, `bill.net_payable` are generated columns.
- **Scoped access** — users see only projects within their `user_scope` org subtree.

## Verifying the demo (after 003)

```sql
SET kwa.current_user_id = '22222222-0000-0000-0000-000000000001'; -- EE Menon

SELECT running_bill_no, gross_amount, total_deductions, net_payable, status
FROM kwa.bill WHERE running_bill_no = 1;
-- expect: gross 1881000.00, deductions 188100.00, net 1692900.00, status 'certified'

SELECT type_code, rate_pct, amount
FROM kwa.bill_deduction ORDER BY amount DESC;
-- IT 37620, GST_TDS 37620, SD 94050, LABOUR_CESS 18810
```

Immutability proof (both should raise an exception):

```sql
UPDATE kwa.mb_entry SET quantity = 9999 WHERE quantity = 1500;     -- locked MB entry
UPDATE kwa.bill SET gross_amount = 0 WHERE running_bill_no = 1;     -- certified bill
```

## Adding future migrations

- Keep them numbered and forward-only (`004_…`, `005_…`).
- One logical change per file; wrap each in `BEGIN; … COMMIT;`.
- Never edit an applied migration — add a new one.
- Reference-data changes (new SOR edition, new deduction scheme) are inserts/new versions, never edits to historical rows.

## Source documents

The design behind these migrations is documented in the parent folder:
`kwa_pipeline_tracking_app_spec.md`, `kwa_spec_review.md`,
`kwa_core_data_model.md`, `kwa_sor_deduction_data_model.md`.
