# KWA Pipeline Works — Spec Review

**Reviewed document:** `kwa_pipeline_tracking_app_spec.md`
**Date:** 16 June 2026
**Verdict:** Strong, domain-aware spec — roughly build-ready, with a handful of audit-critical gaps to close before development.

---

## Summary

This is a genuinely well-informed specification, clearly written by someone who understands both the engineering and the government-accountability reality of Kerala Water Authority / PWD civil works. It builds the whole design around the things that make government pipeline work different — chainage-based linear tracking, milestone-based payment, the Measurement Book as the legal spine, and an immutable audit trail — rather than bolting them onto a generic construction tracker.

The remaining gap is concentrated in three areas that carry the highest audit risk: how rates and statutory deductions are sourced and versioned, how offline conflicts are resolved for financial records, and how data visibility is scoped across the authority's hierarchy.

---

## Strengths

**Domain framing is correct.** The "what makes government pipeline work different" section is the heart of the document and it nails the right four pillars. The AE → AEE → EE sign-off chain, EMD/security deposit, defect liability period, and AG/CAG audit exposure are all real concerns, not invented requirements.

**Priorities are right.** "The Measurement Book is the heart, not the dashboard" is the single most important line in the spec. Officer trust comes from MB → bill → payment traceability, and the document keeps that front and centre.

**Technical choices are coherent and current.** Flutter + Riverpod + PostgreSQL/PostGIS + offline sync is a defensible 2026 stack. PostGIS is correctly flagged as non-negotiable for real chainage geometry, and PowerSync is a sound offline-first Postgres sync choice for poor-connectivity sites.

**Offline-first is treated as a first-class constraint,** not an afterthought — every entity carrying `id / synced / updated_at / deleted / created_by` is the right baseline.

---

## Gaps & risks (prioritized)

### P1 — Audit-critical, fix before building

**1. SOR / rate sourcing is unspecified.**
The MB references "SOR code" and "rate," but government bills live or die on using the *correct, current* Schedule of Rates. KWA/PWD revise these periodically, and projects routinely run against a specific SOR edition fixed at agreement time. There is no module for SOR version management, rate escalation, or non-SOR "extra item" handling. This is one of the most common audit objections in real projects.
→ *Addressed in `kwa_sor_deduction_data_model.md`.*

**2. Deductions are listed but not modeled as rules.**
Bills mention IT / GST / security / labour cess deductions, but these carry statutory rates and thresholds that change over time. Hard-coding them invites silent errors and audit findings. They need a configurable, versioned deduction-rule engine with effective-dating.
→ *Addressed in `kwa_sor_deduction_data_model.md`.*

**3. Conflict resolution is too simple for financial data.**
"Server-wins by `updated_at`" is fine for DPRs and issues, but dangerous for measurement and bill records in a multi-user offline system. Financial and measurement records should be append-only/versioned and lock-after-approval — never last-write-wins. The spec already hints at the right answer; it just needs to be made explicit and per-entity.
→ *Addressed in expanded spec, "Sync & Conflict Policy."*

### P2 — Important, define before Phase 2

**4. Role table covers actions but not data scope.**
Roles define *what* each person can do but not *which* divisions/sub-divisions/projects they can see. For a multi-division authority this is a core access-control requirement and ties directly into division rollup reporting.
→ *Addressed in expanded spec, "Division-Scoped Permissions."*

**5. Field-staff auth may be too weak for legal sign-offs.**
"OTP for field staff" is convenient, but each MB approval/certification is effectively a legal signature. Approval-tier actions warrant stronger assurance (device binding or a second factor on the approval action itself).

**6. No data retention / archival policy.**
Government records carry mandatory retention periods (often years post-completion). "Soft delete only" handles deletion but not long-term archival, AG-audit export, or project close-out.
→ *Addressed in expanded spec, "Data Retention & Archival."*

### P3 — Scope / sequencing

**7. Phase 1 MVP is too broad.**
Auth + projects + offline map tiles + chainage math + DPR + GPS photos + a full sync engine is a large Phase 1. Offline tile caching and chainage geo-math are each substantial on their own. Consider a thin Phase 0 that proves the sync engine + photo upload queue on a single simple entity (DPR) before layering GIS on top — sync is where these projects most often fail.

---

## Recommended next steps

1. Adopt the SOR + deduction data model (separate file) and wire MB/bill calculations to reference a fixed SOR edition per project.
2. Make the sync conflict policy explicit and per-entity; lock financial records as append-only.
3. Add a division-scoped permission layer to the role model.
4. Split Phase 1: prove offline sync on DPR first (Phase 0), then add GIS.
5. Define retention/archival rules and an AG-audit export path before go-live.
