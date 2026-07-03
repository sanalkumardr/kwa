# KWA Pipeline Works — NestJS Backend

A thin, RLS-respecting data-access layer over the Postgres schema in `../migrations`. The database remains the source of truth (RLS, triggers, generated columns, `compute_bill`); the API's job is to authenticate the user and run every query inside a transaction scoped to that user.

## Why `pg` instead of an ORM

The schema relies on features ORMs handle poorly: row-level security keyed off a per-request session variable, `BEFORE`/`AFTER` triggers that lock and audit rows, generated columns, and a stored `compute_bill` function. Using `pg` with a single `withUser` transaction helper keeps the database authoritative and avoids an ORM silently bypassing those guarantees.

## The one rule: every request runs in `withUser`

`DatabaseService.withUser(userId, fn)` opens a transaction, executes
`set_config('kwa.current_user_id', userId, true)`, runs your queries, then commits.
Because the setting is transaction-local, it auto-clears at commit/rollback — no leakage across pooled connections. This is what makes RLS scope projects to the user's org subtree and what gives audit triggers the correct actor. Services never add manual org filters; RLS does it.

## Request flow

```
Bearer JWT ──> AuthGuard (verify, set req.userId = token.sub)
           ──> @CurrentUser() injects userId into the controller
           ──> service calls db.withUser(userId, …)
           ──> SET kwa.current_user_id → RLS + audit apply
```

The token `sub` claim must equal an `app_user.id` (uuid). Tokens are issued by
`/auth/verify-otp` after phone-OTP login (codes are stored hashed in the `otp`
table; set `OTP_DEV_ECHO=true` to have the request endpoint echo the code for
local dev). The dev token helper (`scripts/make-token.js`) bypasses OTP for
quick testing.

## Setup

```bash
cp .env.example .env      # set DATABASE_URL + JWT_SECRET
npm install
npm run start:dev
```

Point `DATABASE_URL` at the database where migrations 001/002(/003) were applied. Use a least-privilege role (e.g. `kwa_app`) that is subject to RLS — never a superuser, which bypasses RLS.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET   | `/health` | Liveness (always 200 if the process is up) |
| GET   | `/health/ready` | Readiness — 200 if the DB is reachable, else 503 |
| POST  | `/auth/request-otp` | Public: send a login code to a phone `{ phone }` |
| POST  | `/auth/verify-otp` | Public: verify `{ phone, code }` → `{ token, userId }` |
| GET   | `/auth/me` | Authenticated user's profile `{ id, name, role }` (role-gates the UI) |
| GET   | `/projects` | List projects (RLS-scoped to the caller's org subtree) |
| POST  | `/tenders` | Create a tender/agreement for a project |
| GET   | `/tenders?projectId=` | Latest tender for a project |
| POST  | `/milestones` | Create a milestone |
| GET   | `/milestones?projectId=` | Milestones for a project |
| PATCH | `/milestones/:id/status` | Update milestone status `{ status }` |
| POST  | `/pipelines/segments` | Store a route reach from a GeoJSON LineString + chainage span |
| GET   | `/pipelines/segments?projectId=` | Segments (as GeoJSON) for a project |
| GET   | `/pipelines/locate?projectId=&lng=&lat=` | Map a GPS fix → nearest chainage + off-route distance |
| GET   | `/pipelines/progress?projectId=` | Planned km (geometry) vs actual laid km (approved MB) + physical % |
| POST  | `/quality-tests` | Record a QC test/inspection result |
| GET   | `/quality-tests?projectId=` | Quality tests for a project |
| POST  | `/issues` | Raise a GPS-pinned site issue/snag |
| GET   | `/issues?projectId=&status=` | Issues for a project (priority-ordered) |
| PATCH | `/issues/:id/status` | Move an issue open → in_progress → resolved |
| POST  | `/documents` | Register an uploaded drawing/permit/agreement `{ projectId, kind, storageKey, expiresOn? }` |
| GET   | `/documents?projectId=` | Documents for a project |
| GET   | `/documents/expiring?projectId=&withinDays=` | Permits/NOCs expiring soon |
| GET   | `/reports/rollup?orgUnitId=` | Division rollup: physical + financial progress per project |
| GET   | `/reports/audit-export?projectId=` | Full AG/CAG audit chain for a project |
| POST  | `/alerts/milestones` | Run the at-risk milestone scan for the caller's scope (also runs daily by cron) |
| POST  | `/mb-entries` | Record a measurement; rate snapshot derived from SOR binding |
| POST  | `/mb-entries/:id/check` | AE check |
| POST  | `/mb-entries/:id/approve` | AEE approve → DB trigger locks the entry immutably |
| GET   | `/mb-entries?milestoneId=` | MB entries for a milestone |
| POST  | `/dpr` | Create a daily progress report (draft) |
| POST  | `/dpr/:id/submit` | Draft → submitted |
| POST  | `/dpr/:id/approve` | Submitted → approved (AE) |
| GET   | `/dpr?projectId=` | DPRs for a project |
| GET   | `/bills?projectId=` | List a project's bills (newest first) |
| POST  | `/bills` | Create a draft bill `{ projectId, referenceDate }` |
| POST  | `/bills/:id/compute` | Pull approved MB entries + apply deductions (calls `kwa.compute_bill`) |
| POST  | `/bills/:id/certify` | Certify → DB trigger locks the bill immutably |
| GET   | `/bills/:id/deductions` | Itemised deductions for a bill |
| POST  | `/payments` | Sanction payment on a certified bill (EE); flips bill → `paid` |
| GET   | `/payments/by-bill/:billId` | Payments against a bill |
| POST  | `/sync/dpr` | Mobile sync: upsert a DPR (last-write-wins); echoes server row |
| GET   | `/sync/dpr?since=` | Mobile sync: DPRs changed since ISO timestamp (incl. soft-deletes) |
| POST  | `/uploads` | Multipart photo upload (`entity`, `entityId`, `file`) → `{ key, url }` |

> **Mobile sync contract** (`/sync/dpr`): the database is authoritative for
> `updated_at` (the touch trigger stamps `now()` on update), so server arrival
> order resolves conflicts — last-write-wins, correct for an operational entity.
> Pull is watermark-based (`updated_at > since`) and returns soft-deleted rows so
> deletions propagate. Both run inside `withUser`, so RLS scopes them. This is the
> backend half of the Phase 0 mobile slice in `../mobile`.

> **Bill lifecycle / immutability:** a bill locks on certification. The only
> change permitted afterwards is the `certified → paid` status flip (enforced by
> the `bill_lock_guard` trigger, which rejects any other column change on a
> locked row). `POST /payments` refuses a bill that is still in `draft`.

## Try it against the demo data

With migration `003_seed_demo.sql` applied, mint a JWT for EE Menon
(`sub = 22222222-0000-0000-0000-000000000001`, signed with `JWT_SECRET`), then:

```bash
TOKEN=...   # HS256 JWT with that sub

curl -H "Authorization: Bearer $TOKEN" localhost:3000/projects

# create + compute a bill for the seeded project
curl -X POST localhost:3000/bills -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"projectId":"55555555-0000-0000-0000-000000000001","referenceDate":"2025-09-05"}'

curl -X POST localhost:3000/bills/<id>/compute -H "Authorization: Bearer $TOKEN"
# => gross 1881000.00, deductions 188100.00, net 1692900.00
```

A user whose `user_scope` does not cover the project's division will get an empty
`/projects` list and cannot create or compute its bills — enforced by the database, not this code.

## Layout

```
src/
  database/   pool + withUser transaction helper (the core)
  auth/       JWT guard + @CurrentUser decorator
  projects/   RLS-scoped read example
  bills/      draft → compute → certify → deductions
  app.module.ts  main.ts
```

## Money-chain safeguards

Beyond the DB-level immutability, the bill/payment path enforces:

- **Idempotent compute** — `compute_bill` clears prior deductions before
  reapplying, so re-running it can't duplicate deduction rows.
- **No double-billing** — an approved MB entry is pulled onto at most one bill.
- **No empty certification** — a bill can't be certified until `compute` has
  pulled at least one approved MB entry (gross > 0).
- **No overpayment** — total payments against a bill can't exceed its net
  payable; payment amounts must be positive.
- **Positive measurements** — MB entry quantity must be > 0.

These are covered by `test/money-chain.e2e-spec.ts`.

## Photo storage

`/uploads` writes through a `Storage` interface (`src/uploads/storage.ts`) chosen
by `STORAGE_PROVIDER`: `local` (disk under `UPLOAD_DIR`, dev/single-node) or
`s3` (any S3-compatible bucket — AWS, MinIO, etc.). The response includes a
`url` (a presigned, time-limited download URL for S3) alongside the stored
`key`. Switching providers is config-only; the controller is unchanged. With S3
the Kubernetes uploads PVC is unnecessary and multi-replica scaling is clean.

## Milestone alerts

A daily cron (`@nestjs/schedule`, 6am) and `POST /alerts/milestones` scan for
milestones that are not done and due within 7 days, and notify the responsible
AE/AEE/EE officers. Delivery goes through a `NotificationSender` (log, or the
shared `SMS_GATEWAY_*` HTTP gateway — point it at a WhatsApp relay for WhatsApp).
The scan runs in an RLS scope: the manual endpoint uses the caller's scope; the
cron uses `SYSTEM_USER_ID` (an admin with authority-wide scope), and is skipped
if that's unset.

## Observability & operations

- **Probes:** `/health` (liveness) and `/health/ready` (readiness — checks the
  DB). Wire k8s `livenessProbe`/`readinessProbe` (or a load balancer) to these.
- **Request logging:** one structured line per request (method, path, status,
  duration, user) via a global interceptor; 4xx warn, 5xx error.
- **Error envelope:** a global exception filter returns
  `{ statusCode, message, path, timestamp }` for every failure and logs 5xx with
  a stack — internals never leak to the client.
- **Graceful shutdown:** `enableShutdownHooks()` closes the pg pool on SIGTERM,
  so rolling deploys drain cleanly.

## Live validation

`test/validate-no-postgis.js` executes the database-enforced guarantees against a
real PostgreSQL (PostGIS stubbed, since the core migrations use geometry only as
column types). It runs alongside the full jest suite (which needs PostGIS, in CI)
and exists because **running the schema for real caught three bugs that parsing
and type-checking did not**:

1. **002 RLS loop** created `bill_line`/`bill_deduction`/`payment` policies
   referencing a `project_id` column not yet added — migrations failed to apply.
2. **`compute_bill`** hard-`DELETE`d prior deductions, which the soft-delete-only
   trigger rejected — re-compute errored. Now soft-deletes; reads filter
   `deleted = false`.
3. **`bill_lock_guard`** compared `to_jsonb(NEW)` vs `OLD` including the STORED
   generated `net_payable`, which reads NULL in a BEFORE trigger — so
   `certified → paid` was always blocked. Now excludes `net_payable`.

A second harness, `test/validate-services.js`, runs the **real compiled NestJS
services** against the live DB (so role enforcement, MB rate derivation, and the
certify/overpayment guards execute for real). It caught a fourth bug:

4. **`compute_bill`** used unqualified table names and relied on the session
   `search_path` including `kwa`. The app's connection pool sets no search_path,
   so it failed with *"relation bill does not exist"* — bills could never be
   computed in production. Fixed by pinning the function's `search_path`.

A third harness, `test/validate-chainage.js`, validates the PostGIS chainage
*composition* without a real PostGIS install: it shims the geometry type and
provides a faithful pure-SQL `ST_LineLocatePoint`, then runs the **real
migration-004 functions and the real pipelines service** — confirming a route
midpoint maps to chainage 1.000 and planned/laid aggregation is correct.

All four bugs are fixed in the migrations. Three harnesses run green against real
PostgreSQL — SQL guarantees (12/12), service-layer guards (10/10), chainage
logic (4/4) — and the full jest suite (with real PostGIS) runs in CI, which
provisions `kwa_app` as a non-superuser so RLS binds.

## Role enforcement (server-side authority)

Privileged actions check the acting user's role **in the same transaction**, via
`requireMinRole` (`src/auth/roles.ts`), using the KWA rank order
`contractor < overseer < ae < aee < ee < admin`:

| Action | Minimum role |
|---|---|
| Record MB entry | overseer |
| Check MB entry | ae |
| Approve MB entry (locks it) | aee |
| Create / compute bill | ae |
| Certify bill (locks it) | aee |
| Sanction payment | ee |

The mobile UI also gates these by role (`/auth/me`), but that's cosmetic — the
database is the real authority, so a tampered client still can't have an
overseer approve a measurement or an AEE sanction a payment.

## Integration tests

The suite in `test/` proves the guarantees that can't be eyeballed, against a
**real** Postgres+PostGIS (no mocks): RLS isolation between divisions, sync
scoping, immutability of approved MB entries and certified bills, the
`certified → paid` exception, `compute_bill` correctness, and MB rate
derivation + approval locking.

```bash
# a throwaway database the test role OWNS (so it can drop/recreate the schema)
createdb kwa_test
export TEST_DATABASE_URL=postgres://<you>@localhost:5432/kwa_test
npm test
```

`resetSchema()` drops the `kwa` schema and re-applies migrations 001/002/003 for
a deterministic start. Because 002 sets `FORCE ROW LEVEL SECURITY`, RLS is
enforced even for the owning role — so the isolation tests are meaningful.
Tests run serially (`maxWorkers: 1`) since they share the one database.

## Extending

Add a module per aggregate (mb-entries, milestones, dpr, payments). Each service
method wraps its queries in `db.withUser(userId, …)`. Keep business invariants
(locking, audit, deduction math) in the database where they already live; the
service layer should orchestrate, not re-implement them.
