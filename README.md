# KWA Pipeline Works

Full-lifecycle tracking for Kerala Water Authority pipeline & civil works —
**sanction → tender → execution → measurement → milestone payment → completion** —
with GIS chainage, GPS-tagged field data, and audit-grade, RLS-enforced records.

A pipeline is a *line*, not a building: progress is measured by chainage along a
route, money is released against measured milestones, and every rupee traces back
through a Measurement Book entry to a sanction — auditable by AG/CAG with no hard
deletes. The whole system is built around those facts.

## Start here

| To… | Read |
|---|---|
| Understand the system | [`ARCHITECTURE.md`](ARCHITECTURE.md) |
| Run it locally (Docker) | [`RUNNING.md`](RUNNING.md) |
| Work on the API | [`backend/README.md`](backend/README.md) |
| Work on the app | [`mobile/README.md`](mobile/README.md) |
| Apply the schema | [`migrations/README.md`](migrations/README.md) |
| Deploy to a cluster | [`k8s/README.md`](k8s/README.md) |
| Domain & data model | `kwa_pipeline_tracking_app_spec.md`, `kwa_core_data_model.md`, `kwa_sor_deduction_data_model.md`, `kwa_spec_review.md` |

## Quickstart

```bash
docker compose up --build          # Postgres+PostGIS, migrations, API on :3000
# then, in backend/:  TOKEN=$(node scripts/make-token.js); curl :3000/projects -H "Authorization: Bearer $TOKEN"
```

See [`RUNNING.md`](RUNNING.md) for the mobile app and the integration tests.

## What's inside

- **Backend** (NestJS + PostgreSQL/PostGIS) — the database is the source of
  truth; the API mediates every access through a per-user transaction. Modules:
  auth (phone-OTP), projects, tenders, milestones, measurement book, DPR, sync,
  uploads, pipelines/GIS, bills, payments, quality, issues, documents, reports
  (rollup + audit export), alerts, health.
- **Mobile** (Flutter, offline-first) — local-first DPR capture with GPS/photos,
  a chainage route map, and online review/approval workflows (MB, bills, issues,
  quality, documents, division dashboard). Phone-OTP login with persisted token.
- **Infra** — `docker-compose` for local, GitHub Actions CI against a
  Postgres+PostGIS service, and Kubernetes manifests with health probes and an
  S3-or-disk storage abstraction.

## How it stays trustworthy

Four layers, all enforced in the database (detailed in
[`ARCHITECTURE.md`](ARCHITECTURE.md) §4):

1. **Row-level security** scopes data to a user's org subtree (`FORCE`d, so the
   app's non-superuser role can't bypass it).
2. **Role enforcement** gates each action by the KWA rank order
   (overseer → AE → AEE → EE).
3. **Immutability** — MB entries lock on approval, bills on certification;
   soft-delete only.
4. **Audit log** — insert-only who/what/when on every change.

The two audit-critical paths — the money chain (sanction → payment) and the
offline sync — each have a dedicated hardening pass with edge-case tests.

## Status

All twelve core spec modules plus the buildable Phase 4 differentiators are
implemented, tested against real PostgreSQL+PostGIS, and deployable. Not built:
drone/AI progress verification (needs ML); real SMS/WhatsApp and S3 credentials
(abstractions in place, config only).
