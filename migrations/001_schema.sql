-- =====================================================================
-- KWA Pipeline Works — PostgreSQL schema (DDL)
-- Target: PostgreSQL 15+ with PostGIS 3.x
-- Generated from kwa_core_data_model.md + kwa_sor_deduction_data_model.md
--
-- Properties enforced here:
--   * Soft delete only (no hard deletes on domain tables)
--   * Sync envelope on every table
--   * MB entries & bills: append-only / lock-after-approval (triggers)
--   * Immutable audit_log written by triggers
--   * Row-level security scoping projects to a user's org subtree
-- =====================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()

CREATE SCHEMA IF NOT EXISTS kwa;
SET search_path = kwa, public;

-- ---------------------------------------------------------------------
-- Shared trigger functions
-- ---------------------------------------------------------------------

-- keep updated_at fresh
CREATE OR REPLACE FUNCTION kwa.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- block hard deletes; force soft delete
CREATE OR REPLACE FUNCTION kwa.block_hard_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Hard delete forbidden on %, set deleted = true instead', TG_TABLE_NAME;
END $$;

-- generic immutability guard for locked financial/legal rows
CREATE OR REPLACE FUNCTION kwa.guard_locked_row()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- OLD is the pre-update state. If it was locked, reject everything
  -- except the audit-trail flip itself (handled in row-specific guards).
  IF OLD.locked_flag THEN
    RAISE EXCEPTION 'Row % is locked after approval and cannot be modified', OLD.id;
  END IF;
  RETURN NEW;
END $$;

-- audit writer: captures before/after as jsonb
CREATE OR REPLACE FUNCTION kwa.write_audit()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_action text;
  v_actor  uuid;
BEGIN
  v_actor := nullif(current_setting('kwa.current_user_id', true), '')::uuid;
  IF (TG_OP = 'INSERT') THEN
    v_action := 'create';
    INSERT INTO kwa.audit_log(entity_table, entity_id, action, actor_id, before, after)
    VALUES (TG_TABLE_NAME, NEW.id, v_action, v_actor, NULL, to_jsonb(NEW));
    RETURN NEW;
  ELSIF (TG_OP = 'UPDATE') THEN
    v_action := CASE
      WHEN NEW.deleted AND NOT OLD.deleted THEN 'soft_delete'
      WHEN to_jsonb(NEW) ? 'locked_flag'
           AND (to_jsonb(NEW)->>'locked_flag')::boolean
           AND NOT (to_jsonb(OLD)->>'locked_flag')::boolean THEN 'lock'
      ELSE 'update'
    END;
    INSERT INTO kwa.audit_log(entity_table, entity_id, action, actor_id, before, after)
    VALUES (TG_TABLE_NAME, NEW.id, v_action, v_actor, to_jsonb(OLD), to_jsonb(NEW));
    RETURN NEW;
  END IF;
  RETURN NULL;
END $$;

-- helper: attach standard triggers to a table
-- (called manually per table below for clarity)

-- =====================================================================
-- 1. ORG & ACCESS
-- =====================================================================

CREATE TABLE org_unit (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  level       text NOT NULL CHECK (level IN
                ('section','subdivision','division','circle','authority')),
  parent_id   uuid REFERENCES org_unit(id),
  code        text,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted     boolean NOT NULL DEFAULT false,
  synced      boolean NOT NULL DEFAULT false
);

CREATE TABLE app_user (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  phone        text UNIQUE NOT NULL,
  role         text NOT NULL CHECK (role IN
                 ('contractor','overseer','ae','aee','ee','admin')),
  home_unit_id uuid REFERENCES org_unit(id),
  device_id    text,
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted      boolean NOT NULL DEFAULT false,
  synced       boolean NOT NULL DEFAULT false
);

CREATE TABLE user_scope (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES app_user(id),
  org_unit_id  uuid NOT NULL REFERENCES org_unit(id),
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted      boolean NOT NULL DEFAULT false,
  synced       boolean NOT NULL DEFAULT false,
  UNIQUE (user_id, org_unit_id)
);

-- recursive descendants of an org unit (for scope checks)
CREATE OR REPLACE FUNCTION kwa.org_subtree(root uuid)
RETURNS TABLE(id uuid) LANGUAGE sql STABLE AS $$
  WITH RECURSIVE t AS (
    SELECT org_unit.id FROM kwa.org_unit WHERE org_unit.id = root
    UNION ALL
    SELECT c.id FROM kwa.org_unit c JOIN t ON c.parent_id = t.id
  ) SELECT id FROM t;
$$;

-- true if the current user can see a given org unit
CREATE OR REPLACE FUNCTION kwa.user_can_see_unit(target uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1
    FROM kwa.user_scope us
    JOIN LATERAL kwa.org_subtree(us.org_unit_id) sub ON true
    WHERE us.user_id = nullif(current_setting('kwa.current_user_id', true),'')::uuid
      AND us.deleted = false
      AND sub.id = target
  );
$$;

-- =====================================================================
-- 2. PROJECT & SANCTION
-- =====================================================================

CREATE TABLE project (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                   text NOT NULL,
  scheme                 text,
  sanction_no            text,
  sanction_amount        numeric(14,2),
  sanctioning_authority  text,
  as_date                date,
  ts_date                date,
  org_unit_id            uuid NOT NULL REFERENCES org_unit(id),
  status                 text NOT NULL DEFAULT 'sanctioned' CHECK (status IN
                           ('sanctioned','tendered','in_progress','completed','archived')),
  archived_at            timestamptz,
  created_by             uuid,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  deleted                boolean NOT NULL DEFAULT false,
  synced                 boolean NOT NULL DEFAULT false
);
CREATE INDEX idx_project_org ON project(org_unit_id);

-- =====================================================================
-- 3. SOR & RATES  (server-authoritative reference data)
-- =====================================================================

CREATE TABLE sor_edition (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code           text UNIQUE NOT NULL,
  title          text,
  authority      text,
  effective_from date,
  effective_to   date,
  status         text NOT NULL DEFAULT 'draft' CHECK (status IN
                   ('draft','published','superseded')),
  published_by   uuid REFERENCES app_user(id),
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted        boolean NOT NULL DEFAULT false,
  synced         boolean NOT NULL DEFAULT false
);

CREATE TABLE sor_item (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_id  uuid NOT NULL REFERENCES sor_edition(id),
  item_code   text NOT NULL,
  description text,
  unit        text,
  base_rate   numeric(14,2) NOT NULL,
  chapter     text,
  is_active   boolean NOT NULL DEFAULT true,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted     boolean NOT NULL DEFAULT false,
  synced      boolean NOT NULL DEFAULT false,
  UNIQUE (edition_id, item_code)
);

CREATE TABLE project_sor_binding (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        uuid NOT NULL REFERENCES project(id),
  edition_id        uuid NOT NULL REFERENCES sor_edition(id),
  tender_premium_pct numeric(6,3) NOT NULL DEFAULT 0,
  bound_at          date,
  created_by        uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted           boolean NOT NULL DEFAULT false,
  synced            boolean NOT NULL DEFAULT false,
  UNIQUE (project_id)
);

CREATE TABLE extra_item (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES project(id),
  description  text NOT NULL,
  unit         text,
  derived_rate numeric(14,2),
  basis        text,
  status       text NOT NULL DEFAULT 'proposed' CHECK (status IN
                 ('proposed','approved','rejected')),
  approved_by  uuid REFERENCES app_user(id),
  approved_at  timestamptz,
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted      boolean NOT NULL DEFAULT false,
  synced       boolean NOT NULL DEFAULT false
);

CREATE TABLE rate_escalation (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES project(id),
  period      daterange,
  index_name  text,
  factor      numeric(8,4),
  approved_by uuid REFERENCES app_user(id),
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted     boolean NOT NULL DEFAULT false,
  synced      boolean NOT NULL DEFAULT false
);

-- =====================================================================
-- 4. TENDER / AGREEMENT
-- =====================================================================

CREATE TABLE contractor (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  gstin      text,
  pan        text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted    boolean NOT NULL DEFAULT false,
  synced     boolean NOT NULL DEFAULT false
);

CREATE TABLE tender (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            uuid NOT NULL REFERENCES project(id),
  tender_no             text,
  contractor_id         uuid REFERENCES contractor(id),
  agreement_value       numeric(14,2),
  work_order_date       date,
  completion_due_date   date,
  emd                   numeric(14,2),
  security_deposit      numeric(14,2),
  defect_liability_until date,
  created_by            uuid,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted               boolean NOT NULL DEFAULT false,
  synced                boolean NOT NULL DEFAULT false
);
CREATE INDEX idx_tender_project ON tender(project_id);

-- =====================================================================
-- 5. PIPELINE / GIS
-- =====================================================================

CREATE TABLE pipeline_segment (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES project(id),
  name          text,
  geom          geometry(LineStringZ, 4326),
  chainage_from numeric(10,3),
  chainage_to   numeric(10,3),
  diameter_mm   int,
  material      text CHECK (material IN ('DI','HDPE','PVC') OR material IS NULL),
  depth_m       numeric(6,2),
  jointing      text,
  status        text NOT NULL DEFAULT 'planned' CHECK (status IN
                  ('planned','in_progress','laid','tested')),
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted       boolean NOT NULL DEFAULT false,
  synced        boolean NOT NULL DEFAULT false
);
CREATE INDEX idx_segment_geom ON pipeline_segment USING gist(geom);
CREATE INDEX idx_segment_project ON pipeline_segment(project_id);

-- =====================================================================
-- 6. MILESTONES
-- =====================================================================

CREATE TABLE milestone (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES project(id),
  name            text NOT NULL,
  chainage_from   numeric(10,3),
  chainage_to     numeric(10,3),
  planned_qty     numeric(14,3),
  unit            text,
  planned_date    date,
  payment_percent numeric(7,4),
  depends_on      uuid REFERENCES milestone(id),
  status          text NOT NULL DEFAULT 'not_started' CHECK (status IN
                    ('not_started','in_progress','done','at_risk')),
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted         boolean NOT NULL DEFAULT false,
  synced          boolean NOT NULL DEFAULT false
);
CREATE INDEX idx_milestone_project ON milestone(project_id);

-- =====================================================================
-- 7. MEASUREMENT BOOK  (append-only / lock-after-approval)
-- =====================================================================

CREATE TABLE mb_entry (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES project(id),
  milestone_id  uuid NOT NULL REFERENCES milestone(id),
  sor_item_id   uuid REFERENCES sor_item(id),
  extra_item_id uuid REFERENCES extra_item(id),
  chainage_from numeric(10,3),
  chainage_to   numeric(10,3),
  quantity      numeric(14,3) NOT NULL,
  unit          text,
  rate_snapshot numeric(14,2) NOT NULL,
  amount        numeric(14,2) GENERATED ALWAYS AS (quantity * rate_snapshot) STORED,
  gps           geometry(Point, 4326),
  photos        jsonb NOT NULL DEFAULT '[]'::jsonb,
  measured_by   uuid NOT NULL REFERENCES app_user(id),
  checked_by    uuid REFERENCES app_user(id),
  approved_by   uuid REFERENCES app_user(id),
  locked_flag   boolean NOT NULL DEFAULT false,
  approved_at   timestamptz,
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted       boolean NOT NULL DEFAULT false,
  synced        boolean NOT NULL DEFAULT false,
  CONSTRAINT mb_one_item CHECK (
    (sor_item_id IS NOT NULL) <> (extra_item_id IS NOT NULL)
  )
);
CREATE INDEX idx_mb_milestone ON mb_entry(milestone_id);
CREATE INDEX idx_mb_project ON mb_entry(project_id);

-- lock guard: once locked, only the approval transition is allowed,
-- and after that nothing changes.
CREATE OR REPLACE FUNCTION kwa.mb_lock_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.locked_flag THEN
    RAISE EXCEPTION 'MB entry % is locked (approved) and is immutable', OLD.id;
  END IF;
  -- when approving, stamp and lock
  IF NEW.approved_by IS NOT NULL AND OLD.approved_by IS NULL THEN
    NEW.locked_flag := true;
    NEW.approved_at := now();
  END IF;
  RETURN NEW;
END $$;

-- =====================================================================
-- 8. DAILY PROGRESS REPORT
-- =====================================================================

CREATE TABLE dpr (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          uuid NOT NULL REFERENCES project(id),
  report_date         date NOT NULL,
  weather             text,
  manpower            jsonb,
  machinery           jsonb,
  length_laid_today_m numeric(10,2),
  chainage_reached    numeric(10,3),
  work_done           text,
  work_planned        text,
  photos              jsonb NOT NULL DEFAULT '[]'::jsonb,
  blockers            text,
  status              text NOT NULL DEFAULT 'draft' CHECK (status IN
                        ('draft','submitted','approved')),
  approved_by         uuid REFERENCES app_user(id),
  created_by          uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted             boolean NOT NULL DEFAULT false,
  synced              boolean NOT NULL DEFAULT false,
  UNIQUE (project_id, report_date)
);

-- =====================================================================
-- 9. DEDUCTIONS, BILLS & PAYMENT
-- =====================================================================

CREATE TABLE deduction_type (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code       text UNIQUE NOT NULL,        -- IT, GST_TDS, SD, LABOUR_CESS
  name       text,
  direction  text CHECK (direction IN ('recoverable','statutory')),
  refundable boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted    boolean NOT NULL DEFAULT false,
  synced     boolean NOT NULL DEFAULT false
);

CREATE TABLE deduction_scheme (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code           text UNIQUE NOT NULL,
  effective_from date NOT NULL,
  effective_to   date,
  status         text NOT NULL DEFAULT 'draft' CHECK (status IN
                   ('draft','active','superseded')),
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted        boolean NOT NULL DEFAULT false,
  synced         boolean NOT NULL DEFAULT false
);

CREATE TABLE deduction_rule (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scheme_id        uuid NOT NULL REFERENCES deduction_scheme(id),
  type_id          uuid NOT NULL REFERENCES deduction_type(id),
  basis            text NOT NULL CHECK (basis IN ('gross','taxable','pre_tax_value')),
  rate_pct         numeric(7,4) NOT NULL,
  threshold_amount numeric(14,2),
  cap_amount       numeric(14,2),
  calc_order       int NOT NULL DEFAULT 0,
  rounding         text NOT NULL DEFAULT 'nearest' CHECK (rounding IN
                     ('nearest','up','down')),
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted          boolean NOT NULL DEFAULT false,
  synced           boolean NOT NULL DEFAULT false
);
CREATE INDEX idx_rule_scheme ON deduction_rule(scheme_id, calc_order);

CREATE TABLE bill (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid NOT NULL REFERENCES project(id),
  running_bill_no  int NOT NULL,
  reference_date   date NOT NULL,
  gross_amount     numeric(14,2) NOT NULL DEFAULT 0,
  total_deductions numeric(14,2) NOT NULL DEFAULT 0,
  net_payable      numeric(14,2) GENERATED ALWAYS AS
                     (gross_amount - total_deductions) STORED,
  certified_by     uuid REFERENCES app_user(id),
  status           text NOT NULL DEFAULT 'draft' CHECK (status IN
                     ('draft','certified','paid')),
  certified_at     timestamptz,
  locked_flag      boolean NOT NULL DEFAULT false,
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted          boolean NOT NULL DEFAULT false,
  synced           boolean NOT NULL DEFAULT false,
  UNIQUE (project_id, running_bill_no)
);

CREATE TABLE bill_line (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id     uuid NOT NULL REFERENCES bill(id),
  mb_entry_id uuid NOT NULL REFERENCES mb_entry(id),
  quantity    numeric(14,3) NOT NULL,
  rate        numeric(14,2) NOT NULL,
  amount      numeric(14,2) GENERATED ALWAYS AS (quantity * rate) STORED,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted     boolean NOT NULL DEFAULT false,
  synced      boolean NOT NULL DEFAULT false
);
CREATE INDEX idx_billline_bill ON bill_line(bill_id);

CREATE TABLE bill_deduction (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id      uuid NOT NULL REFERENCES bill(id),
  rule_id      uuid REFERENCES deduction_rule(id),
  type_code    text NOT NULL,             -- snapshot
  basis_amount numeric(14,2) NOT NULL,
  rate_pct     numeric(7,4) NOT NULL,     -- snapshot
  amount       numeric(14,2) NOT NULL,
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted      boolean NOT NULL DEFAULT false,
  synced       boolean NOT NULL DEFAULT false
);
CREATE INDEX idx_billded_bill ON bill_deduction(bill_id);

CREATE TABLE payment (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id       uuid NOT NULL REFERENCES bill(id),
  amount        numeric(14,2) NOT NULL,
  sanctioned_by uuid REFERENCES app_user(id),
  payment_date  date,
  reference     text,
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted       boolean NOT NULL DEFAULT false,
  synced        boolean NOT NULL DEFAULT false
);

-- bill lock guard: lock on certification, immutable thereafter
CREATE OR REPLACE FUNCTION kwa.bill_lock_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.locked_flag THEN
    -- A locked (certified) bill is immutable EXCEPT for the single
    -- certified -> paid transition. Permit that and nothing else: every
    -- other column (ignoring status/updated_at) must be unchanged.
    -- net_payable is a STORED generated column and reads as NULL inside a
    -- BEFORE trigger, so it must be excluded from the equality check (it is
    -- derived from gross/deductions, which are compared anyway).
    IF NEW.status = 'paid' AND OLD.status = 'certified'
       AND (to_jsonb(NEW) - 'status' - 'updated_at' - 'net_payable')
         = (to_jsonb(OLD) - 'status' - 'updated_at' - 'net_payable') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Bill % is certified and immutable', OLD.id;
  END IF;
  IF NEW.certified_by IS NOT NULL AND OLD.certified_by IS NULL THEN
    NEW.status := 'certified';
    NEW.certified_at := now();
    NEW.locked_flag := true;
  END IF;
  RETURN NEW;
END $$;

-- =====================================================================
-- 10. QUALITY, ISSUES, DOCUMENTS
-- =====================================================================

CREATE TABLE quality_test (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          uuid NOT NULL REFERENCES project(id),
  pipeline_segment_id uuid REFERENCES pipeline_segment(id),
  test_type           text CHECK (test_type IN
                        ('hydro','pressure','compaction','material')),
  result              text CHECK (result IN ('pass','fail') OR result IS NULL),
  value               text,
  tested_at           date,
  qc_by               uuid REFERENCES app_user(id),
  created_by          uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted             boolean NOT NULL DEFAULT false,
  synced              boolean NOT NULL DEFAULT false
);

CREATE TABLE issue (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES project(id),
  location    geometry(Point, 4326),
  title       text NOT NULL,
  priority    text CHECK (priority IN ('low','med','high')),
  assignee_id uuid REFERENCES app_user(id),
  due_date    date,
  status      text NOT NULL DEFAULT 'open' CHECK (status IN
                ('open','in_progress','resolved')),
  photos      jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted     boolean NOT NULL DEFAULT false,
  synced      boolean NOT NULL DEFAULT false
);
CREATE INDEX idx_issue_geom ON issue USING gist(location);

CREATE TABLE document (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES project(id),
  kind        text CHECK (kind IN
                ('drawing','permit','agreement','mb_scan','noc')),
  version     int NOT NULL DEFAULT 1,
  storage_key text NOT NULL,
  expires_on  date,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted     boolean NOT NULL DEFAULT false,
  synced      boolean NOT NULL DEFAULT false
);

-- =====================================================================
-- 11. AUDIT LOG (insert-only)
-- =====================================================================

CREATE TABLE audit_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_table text NOT NULL,
  entity_id    uuid NOT NULL,
  action       text NOT NULL,
  actor_id     uuid,
  at           timestamptz NOT NULL DEFAULT now(),
  before       jsonb,
  after        jsonb
);
CREATE INDEX idx_audit_entity ON audit_log(entity_table, entity_id);

-- audit_log is insert-only: block updates and deletes
CREATE OR REPLACE FUNCTION kwa.block_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is immutable (insert-only)';
END $$;
CREATE TRIGGER trg_audit_no_update BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION kwa.block_mutation();

-- =====================================================================
-- 12. ATTACH STANDARD TRIGGERS
--   touch_updated_at + write_audit + block_hard_delete on domain tables
-- =====================================================================

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'org_unit','app_user','user_scope','project',
    'sor_edition','sor_item','project_sor_binding','extra_item','rate_escalation',
    'contractor','tender','pipeline_segment','milestone','mb_entry','dpr',
    'deduction_type','deduction_scheme','deduction_rule',
    'bill','bill_line','bill_deduction','payment',
    'quality_test','issue','document'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER trg_touch_%1$s BEFORE UPDATE ON %1$s
         FOR EACH ROW EXECUTE FUNCTION kwa.touch_updated_at();', t);
    EXECUTE format(
      'CREATE TRIGGER trg_audit_%1$s AFTER INSERT OR UPDATE ON %1$s
         FOR EACH ROW EXECUTE FUNCTION kwa.write_audit();', t);
    EXECUTE format(
      'CREATE TRIGGER trg_nodelete_%1$s BEFORE DELETE ON %1$s
         FOR EACH ROW EXECUTE FUNCTION kwa.block_hard_delete();', t);
  END LOOP;
END $$;

-- row-specific lock guards (run BEFORE the touch trigger via name ordering)
CREATE TRIGGER trg_mb_lock BEFORE UPDATE ON mb_entry
  FOR EACH ROW EXECUTE FUNCTION kwa.mb_lock_guard();
CREATE TRIGGER trg_bill_lock BEFORE UPDATE ON bill
  FOR EACH ROW EXECUTE FUNCTION kwa.bill_lock_guard();

-- =====================================================================
-- 13. ROW-LEVEL SECURITY (project scoping)
--   App sets: SET kwa.current_user_id = '<uuid>';  per request/connection.
-- =====================================================================

ALTER TABLE project ENABLE ROW LEVEL SECURITY;

CREATE POLICY project_scope_select ON project
  FOR SELECT USING (kwa.user_can_see_unit(org_unit_id));
CREATE POLICY project_scope_modify ON project
  FOR ALL USING (kwa.user_can_see_unit(org_unit_id))
           WITH CHECK (kwa.user_can_see_unit(org_unit_id));

-- child tables inherit scope via their project_id.
-- Example for one table; replicate the pattern for every project-scoped table.
ALTER TABLE mb_entry ENABLE ROW LEVEL SECURITY;
CREATE POLICY mb_scope ON mb_entry
  FOR ALL
  USING (EXISTS (SELECT 1 FROM project p
                 WHERE p.id = mb_entry.project_id
                   AND kwa.user_can_see_unit(p.org_unit_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM project p
                 WHERE p.id = mb_entry.project_id
                   AND kwa.user_can_see_unit(p.org_unit_id)));

-- NOTE: repeat the mb_scope pattern for tender, pipeline_segment, milestone,
-- dpr, bill, bill_line, bill_deduction, payment, quality_test, issue, document,
-- extra_item, rate_escalation, project_sor_binding.
-- Reference data (sor_*, deduction_*) is global read; restrict writes to admins
-- in application logic or a separate admin role.

COMMIT;
