# KWA Pipeline Works — Architecture

A full-lifecycle tracking system for Kerala Water Authority pipeline/civil works:
sanction → tender → execution → measurement → milestone payment → completion,
with GIS chainage, GPS-tagged field data, and audit-grade records. This document
is the map to everything in the repository.

---

## 1. What it is, in one paragraph

A government pipeline project is a *line*, not a building: progress is measured by
chainage along a route, money is released against measured milestones, and every
rupee must trace back through a Measurement Book entry to a sanction — auditable
by AG/CAG with no hard deletes. The system is built around those facts: an
RLS-enforced PostgreSQL/PostGIS database is the source of truth, a NestJS API
mediates access, and an offline-first Flutter app lets field staff record work
where connectivity is poor.

---

## 2. Repository layout

```
kwa/
  ARCHITECTURE.md            ← this file
  RUNNING.md                 ← run the whole stack locally (Docker)
  docker-compose.yml         ← db + migrate + api for local dev
  db/                        ← superuser bootstrap + migration runner (Docker)
  migrations/                ← 001–005 SQL, applied in order
  backend/                   ← NestJS API (the only thing that talks to the DB)
  mobile/                    ← Flutter field app (Phases 0–2 + GIS)
  k8s/                       ← Kubernetes manifests (Deployment, Job, probes…)
  .github/workflows/ci.yml   ← CI: tests vs a Postgres+PostGIS service
  *.md, *.sql (root)         ← spec, review, data-model docs, source SQL
```

The design documents (`kwa_pipeline_tracking_app_spec.md`, `kwa_spec_review.md`,
`kwa_core_data_model.md`, `kwa_sor_deduction_data_model.md`) explain the domain
and the data model in depth; this file summarises and links the implementation.

---

## 3. Components & data flow

```
Flutter app ──HTTPS(JWT)──▶ NestJS API ──pg(withUser tx)──▶ PostgreSQL + PostGIS
   │  offline-first             │  RLS + roles + triggers          │
   │  SQLite + outbox           │  storage abstraction             │
   └─ photos ──▶ /uploads ──────┴──▶ local disk or S3              └─ audit_log
```

- **Database** is authoritative. Business invariants (immutability, audit,
  generated money columns, chainage math, deduction engine) live here so no
  client can bypass them.
- **API** authenticates the caller and runs every query inside a transaction
  bound to that user (`withUser`), which is what makes RLS and audit work.
- **Mobile** writes locally first and mirrors to the server via an outbox; GIS
  and review/approval data are pulled online and shown read-only.

---

## 4. Security model (the heart of trust)

Four independent layers, each enforced in the database:

1. **Row-level security (scope).** Every project-scoped table has an RLS policy:
   a row is visible only if its project's org unit is within the caller's
   `user_scope` subtree. `FORCE ROW LEVEL SECURITY` makes this bind even for the
   table owner, so the app connects as a non-superuser role (`kwa_app`) and
   cannot see across divisions. The API sets `kwa.current_user_id` per request
   (transaction-local), which the policies read.

2. **Role enforcement (authority).** Privileged actions check the actor's role
   *in the same transaction* via `requireMinRole`, against the rank order
   `contractor < overseer < ae < aee < ee < admin`. Recording a measurement,
   checking it, approving it, certifying a bill, and sanctioning a payment each
   require a minimum role — so a tampered client can't have an overseer approve
   their own work.

3. **Immutability (legality).** Measurement Book entries lock on approval and
   bills lock on certification, enforced by `BEFORE UPDATE` triggers; the only
   post-lock change permitted is the `certified → paid` bill transition. Soft
   delete only — hard `DELETE` is blocked everywhere.

4. **Audit trail (accountability).** An insert-only `audit_log`, written by
   triggers, records who/what/when (before/after JSON) on every mutation.
   `GET /reports/audit-export` reassembles a project's full chain for AG/CAG.

---

## 5. The money chain (sanction → payment)

The audit-critical path, and the part most carefully guarded:

```
SOR edition + tender premium ─┐
                              ▼
measurement → MB entry (rate snapshot frozen) → AE check → AEE approve (locks)
                                                                  │
bill ◀── compute_bill: pull approved MB into bill_line,          │
         apply versioned deduction rules (IT/GST/SD/cess)        │
   │      → gross, deductions, net (generated columns)           │
   ├── AEE certify (locks)                                        │
   └── EE sanction payment(s) ──▶ certified → paid                │
audit_log ◀───────────────────────────────────────── every step ┘
```

Safeguards (`test/money-chain.e2e-spec.ts`): `compute_bill` is idempotent
(clears prior deductions before reapplying), an approved MB entry is billed at
most once, an empty bill can't be certified, total payments can't exceed net
payable, and quantities/amounts must be positive. Rates and deduction rates are
**snapshotted** onto records, so later SOR or scheme revisions never alter
historical bills.

See `kwa_sor_deduction_data_model.md` for the SOR/deduction schema rationale.

---

## 6. GIS & chainage (Phase 1)

A pipeline route is stored as real PostGIS `LineStringZ` geometry, not lat/lng
points. Migration `004_chainage.sql` adds SQL functions that turn geometry into
the numbers the app needs:

- `locate_chainage(project, lng, lat)` projects a GPS fix onto the nearest reach
  and returns the chainage (km) + off-alignment distance. The DPR sync uses this
  to **auto-tag** each report's chainage server-side.
- `project_planned_km` (sum of segment spans) vs `project_laid_km` (sum of
  *approved* MB chainage ranges) drive physical-progress %, so progress is
  audit-aligned with the bill chain — not self-reported.

The mobile map renders the route coloured by status; the division rollup
aggregates physical + financial progress per project.

---

## 7. Offline-first sync (Phase 0)

Field sites have poor connectivity, so the app is local-first:

- Writes land in local SQLite **and** an ordered `outbox` in one transaction,
  then return — never blocking on the network.
- `SyncEngine` pushes the outbox in order, pulls server changes since a
  watermark, then drains a retrying photo-upload queue. The three phases run
  independently.
- Conflict policy is **per-entity**: DPR (operational) is server-wins by
  `updated_at`, but the pull never clobbers a row with a pending local edit.
  Financial/legal entities are append-only/lock-after-approval and are never
  authored offline; reference/GIS data is pull-only.
- **Poison rows** (payloads the server permanently rejects with a 4xx) are
  quarantined rather than retried forever, so one bad record can't wedge the
  queue. Per-id ordering is preserved.

The server side is two delta endpoints (`POST`/`GET /sync/dpr`) plus
`/uploads`; the DB stays authoritative for `updated_at`.

---

## 8. Backend modules

Auth (phone-OTP → JWT, `/auth/me`), projects, tenders, milestones, mb-entries,
dpr, sync, uploads (local/S3), pipelines (GIS), bills, payments, quality, issues,
documents (drawings/permits + expiry), reports (rollup + audit export), alerts
(at-risk milestone notifications, daily cron), health (liveness/readiness). Every
service method routes through `withUser`. See `backend/README.md` for the full
endpoint table and the `withUser` contract.

Cross-cutting: a global request-logging interceptor, a consistent error-envelope
filter, graceful shutdown, and pluggable SMS/WhatsApp + storage providers chosen
by config.

---

## 9. Deployment & operations

- **Local:** `docker compose up` (db + migrate + api). See `RUNNING.md`.
- **CI:** GitHub Actions runs the integration suite against a Postgres+PostGIS
  service container on every push, with `kwa_app` owning a throwaway DB so RLS
  binds.
- **Cluster:** `k8s/` — Deployment (2 replicas, liveness `/health`, readiness
  `/health/ready`), Service, Ingress, HPA, a migration Job (skips the demo
  seed), config/secret, and an uploads PVC (droppable when using S3).

Across all three, the app connects as the non-superuser `kwa_app` role — the
single most important operational invariant, because superusers bypass RLS.

---

## 10. Testing

Integration tests run against **real** PostgreSQL+PostGIS (no mocks), proving the
guarantees that can't be eyeballed:

- `guarantees.e2e-spec.ts` — RLS isolation, sync scoping, MB/bill immutability,
  `certified → paid`, `compute_bill` correctness, role enforcement.
- `money-chain.e2e-spec.ts` — compute idempotency, no double-billing, no empty
  certification, no overpayment, positive-quantity guards.
- `pipelines.e2e-spec.ts` — chainage math, planned vs laid km.
- `auth-gps.e2e-spec.ts` — OTP login, GPS→chainage tagging.
- `quality-issues.e2e-spec.ts`, `reports-documents.e2e-spec.ts`,
  `alerts.e2e-spec.ts` — module behaviour + RLS scoping.

Run: `createdb kwa_test`, set `TEST_DATABASE_URL`, `npm test` (see
`backend/README.md`).

---

## 11. What's deliberately not built

- **Drone/aerial + AI progress verification** — needs ML models and compute.
- **Real SMS/WhatsApp gateway + S3 bucket** — abstractions and config are in
  place; only credentials/endpoints remain.
- **Token persistence note:** implemented (secure storage); the one documented
  follow-up is linking uploaded photo keys back onto `dpr.photos`.

Everything else in the original spec's twelve core modules plus the buildable
Phase 4 differentiators (division rollup, audit export, documents, milestone
alerts) is implemented, tested, and deployable.
