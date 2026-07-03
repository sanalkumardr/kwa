# KWA Pipeline Works — Government Project Tracking App

**Domain:** Kerala Water Authority (KWA) / PWD-style government pipeline & civil works
**Goal:** Full lifecycle tracking — sanction → tender → execution → measurement → milestone payment → completion — with GIS, GPS-tagged field data, and audit-grade records
**Approach:** Offline-first, GIS-driven, milestone-based, Android-priority, government-accountable

---

## What makes GOVERNMENT pipeline work different (read first)

Generic construction apps miss these. Your app must be built around them:

1. **Chainage-based linear tracking** — a pipeline is a line, not a building. Progress is measured per chainage (km 0+000 → 12+450), not per floor. Reference: MapMyProject supports chainage-based linear projects with polyline map zones.
2. **Milestone-based payment** — government releases money against measured milestones, not lump sums. Indian PMG portal runs milestone-based monitoring to catch delays at each execution stage. Your spine is: milestone → measurement book entry → bill → payment.
3. **Measurement Book (MB)** — the legal record of work done. Every payment traces back to an MB entry. Must be digital, GPS-stamped, and immutable once approved.
4. **Audit trail** — government work is audited (AG/CAG). Every record needs who/what/when, no hard deletes.
5. **Tender / agreement stage** — work order, agreement value, contractor, EMD/security deposit, defect liability period.
6. **Hierarchy sign-off** — Asst. Engineer → Asst. Executive Engineer → Executive Engineer approval chain mirrors PWD/KWA structure.

---

## Latest Technology Stack (2026)

### Mobile (field)
| Layer | Choice | Why latest/best |
|---|---|---|
| Framework | **Flutter (latest stable, Dart 3+)** | Single codebase, strong offline, mature GIS plugins |
| State | **Riverpod 2.x** | Compile-safe, testable, modern replacement for Provider |
| Local DB | **Drift** (SQLite) or **Isar** | Reactive, offline-first; Drift for relational integrity |
| Maps/GIS | **flutter_map** + MapTiler/OSM, or **Mapbox Maps SDK** | Vector tiles, offline map caching, polyline/chainage rendering |
| Geo | geolocator, geocoding, **turf-style geo math** for chainage calc | Distance-along-line, geofencing |
| Offline sync | Custom sync engine + **PowerSync** or Supabase Realtime | PowerSync = purpose-built offline-first Postgres sync (2026 best-in-class) |
| Files/PDF | syncfusion_flutter_pdfviewer, printing | Digital MB & DPR PDF generation |
| Auth | flutter_secure_storage + JWT / OTP | Secure, OTP for field staff |

### Backend
| Layer | Choice |
|---|---|
| API | **NestJS** (your existing) or Supabase (Postgres + RLS + Auth) |
| DB | **PostgreSQL + PostGIS** ← critical: PostGIS handles spatial pipeline geometry, chainage, zones |
| Sync | PowerSync / Supabase Realtime |
| Storage | S3-compatible (geo-tagged photos, drawings, MB scans) |
| Notifications | Firebase Cloud Messaging |

### Optional "latest ideas" (differentiators)
- **Drone/aerial progress** — periodic flyovers; aerial perspective + 3D mapping is strong for linear civil/infrastructure footprints.
- **AI progress verification** — compare GPS-tagged site photos against planned milestone to flag mismatches.
- **BIM/GIS overlay** — for larger schemes.
- **WhatsApp/SMS milestone alerts** to officers (fits Kerala govt comms habits).

---

## Core Modules

### 1. Project & Sanction
project_id, name, scheme, sanction_no, sanction_amount, sanctioning_authority, AS (Administrative Sanction) date, TS (Technical Sanction) date, division/sub-division, status

### 2. Tender / Agreement
tender_no, contractor, agreement_value, work_order_date, completion_due_date, EMD, security_deposit, defect_liability_period

### 3. Pipeline / GIS (the spine)
- Route as **polyline** with chainage markers (0+000 → end)
- Zones/reaches drawn on map or imported via **KML/GeoJSON**
- Pipe attributes: diameter, material (DI/HDPE/PVC), depth, jointing type
- Map shows **planned vs actual laid length**, color-coded by status

### 4. Milestones
milestone_id, project_id, name, chainage_from, chainage_to, planned_qty, planned_date, payment_percent, status, dependency
→ Drives payment. Delay at any milestone flags for course correction.

### 5. Measurement Book (MB) — digital, legal record
mb_entry_id, milestone_id, chainage_from, chainage_to, item (SOR code), quantity, unit, rate, amount, gps, photos, measured_by, checked_by, approved_by, locked_flag
→ Immutable after approval. Auto-totals into bills.

### 6. Daily Progress Report (DPR)
date, weather, manpower by trade, machinery, length laid today, chainage reached, work_done, work_planned, GPS-tagged photos, delays/blockers
→ Manager approval workflow → auto PDF for submission.

### 7. Bills & Payment
running_bill_no, MB references, gross_amount, deductions (IT/GST/security/labour cess), net_payable, certified_by, payment_status, payment_date
→ Traces every rupee back to MB → milestone.

### 8. Quality & Testing
hydro-test records, pressure test, compaction, material test certificates, inspection checklists, QC sign-off per reach

### 9. Issues / Snags
GPS-pinned issues with photos, priority, assignee, due date, full status trail open → resolved

### 10. Documents & Drawings
GA drawings (versioned), permits (road cutting, NOC), agreements, MB scans, expiry alerts

### 11. Dashboard & Reports
- Map view: planned vs actual along route
- Physical % vs financial % progress (measured against target dates & quantities)
- S-curve, milestone RAG status, delay alerts
- Officer-wise / contractor-wise / division-wise rollup
- Auto-generated DPR & bill PDFs for client submission

### 12. Audit Log
Immutable who/what/when on every record. Soft delete only.

---

## User Roles (KWA/PWD hierarchy)

| Role | Can do |
|---|---|
| Contractor | DPR entry, photos, raise measurement request |
| Overseer / Site Engineer | Record MB, attendance, issues |
| Assistant Engineer (AE) | Check MB, approve DPR |
| Asst. Executive Engineer (AEE) | Verify measurements, certify bills |
| Executive Engineer (EE) | Approve milestones, sanction payment |
| Admin / SE | Full visibility, division rollup, reports |

---

## Offline-First Design (non-negotiable)

Sites have poor connectivity. Every entity carries: `id`, `synced`, `updated_at`, `deleted`, `created_by`.
- Queue local writes → push on reconnect → pull server changes
- Conflict: server-wins by `updated_at`; MB entries lock after approval so no conflict possible
- Offline map tiles cached per project route
- Photo upload queue with retry

---

## Build Sequence

| Phase | Scope |
|---|---|
| **Phase 1 (MVP)** | Auth + project list + map route (chainage) + DPR + GPS photos + offline sync |
| **Phase 2** | Measurement Book + milestones + approval workflow |
| **Phase 3** | Bills/payment + quality tests + dashboard (planned vs actual map) |
| **Phase 4** | Drawings, audit reports, drone/AI progress, WhatsApp alerts, division rollup |

---

## Reference apps studied

- **MapMyProject** (Saffron Consulting, Bengaluru) — closest match: GIS-powered, chainage-based linear projects, structured DPR with GPS photos, approval workflow, auto PDF DPR, Gantt-to-map linking, planned-vs-actual on map.
- **Procore** — daily logs, photo documentation, RFIs, punch lists (mid-large reference).
- **PMG / PAIMANA / PFMS (Govt of India)** — milestone-based monitoring, physical-vs-financial progress against target dates, fund tracking model.
- **MP PWD GPMS/PMMIS, PWD Delhi SEWA** — government PWD project monitoring + WhatsApp citizen channel patterns.

---

## Spec Additions (v2) — closing the audit gaps

These sections fill gaps identified in review. See `kwa_sor_deduction_data_model.md` for the supporting schema.

### 13. Schedule of Rates (SOR) & Rates

Government bills must use the *correct, current* SOR. Don't treat rate as a free-text field on the MB.

- **SOR editions:** each is a published rate book (e.g., `KWA-2025-26`). A project locks to one edition at agreement time; later editions never retroactively change that project's rates.
- **Tender premium:** contractor's quoted above/below percentage is stored once per project and applied to every SOR line. Effective rate = `base_rate × (1 + premium%)`.
- **Extra items:** non-SOR work needs rate analysis and EE-level approval before it can appear on a bill.
- **Escalation (Phase 3+):** price-adjustment clauses for long schemes, approved and date-ranged.
- SOR editions and rates are **server-authoritative** — devices pull, never push. This removes offline conflicts on rate data entirely.

### Sync & Conflict Policy (replaces the simple "server-wins" rule)

Conflict handling is **per-entity**, not one global rule:

| Entity class | Examples | Policy |
|---|---|---|
| Operational | DPR, attendance, issues, photos | Server-wins by `updated_at`; safe to merge |
| Reference (read-only on device) | SOR editions, deduction schemes, drawings | Pull-only; never written offline |
| Financial / legal | MB entries, bills, deductions | **Append-only + lock-after-approval.** No last-write-wins, ever. Corrections issue a new version. |

MB entries lock on approval so a conflict is structurally impossible. Bills snapshot their rates and deduction rates at certification, so later reference-data changes cannot alter history.

### Division-Scoped Permissions (roles need *scope*, not just actions)

The role table defines *what* a user can do; this defines *what they can see*. Each user is assigned a **scope** in the KWA hierarchy:

- Scope levels: Section → Sub-division → Division → Circle → Authority-wide.
- A user sees and acts only on projects within their scope (e.g., an AE sees their section; an EE sees their division; SE/Admin sees the circle/authority).
- Every query is scope-filtered server-side; division rollup reports aggregate upward within the viewer's scope.
- Scope is enforced at the API/RLS layer (PostgreSQL row-level security maps cleanly here), not just hidden in the UI.

### Data Retention & Archival

Government records carry mandatory retention periods (often years after completion).

- **Soft delete only** everywhere (already in spec) — but add explicit retention windows per record type.
- **Project close-out:** on completion + DLP expiry, a project is archived (read-only) rather than deleted.
- **AG/CAG audit export:** one-click export of a project's full chain (sanction → tender → MB → bills → deductions → payments → audit log) as a signed PDF/CSV bundle.
- **Stronger sign-off auth:** approval-tier actions (certify/approve/sanction) require a second factor or device binding on the action itself, since each is effectively a legal signature.

### Suggested Phase 0 (de-risk before Phase 1)

Prove the hardest part first: a thin slice of **auth + single DPR entity + photo upload queue + offline sync round-trip**, with no GIS. Sync is where these projects most often fail; validating it on one simple entity before layering chainage/maps on top materially de-risks the schedule.

---

## Hard-won notes

- The **Measurement Book is the heart**, not the dashboard. Get MB → bill → payment traceability right and the app is trusted by officers.
- **PostGIS + chainage math** is what makes this a real pipeline app vs a generic tracker. Don't store the route as plain lat/lng points — store proper geometry.
- Milestone-based monitoring exists to catch delays early; surface the **next-at-risk milestone** prominently.
- Offline + GPS-stamped + immutable-after-approval = audit-proof. That's your moat for government adoption.
