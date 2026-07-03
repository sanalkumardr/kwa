-- =====================================================================
-- 002_rls.sql — Row-level security on all project-scoped tables
-- Run after 001_schema.sql. Structural; safe for all environments.
-- =====================================================================

BEGIN;
SET search_path = kwa, public;

-- project and mb_entry had RLS enabled in 001; FORCE them here too so the
-- owner is subject to the policies, not just non-owner roles.
ALTER TABLE project FORCE ROW LEVEL SECURITY;
ALTER TABLE mb_entry FORCE ROW LEVEL SECURITY;

-- PART A — Row-level security on all project-scoped tables
-- =====================================================================
-- Reusable: a table is visible if its project_id belongs to an org unit
-- inside the current user's scope subtree.

-- These tables have a real project_id column (from 001), so a direct
-- project-scoped policy applies. bill_line / bill_deduction / payment are
-- handled separately below — they don't have project_id at this point (it is
-- added further down), so including them here would fail at policy creation.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tender','pipeline_segment','milestone','dpr',
    'bill','quality_test','issue','document','extra_item',
    'rate_escalation','project_sor_binding'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    -- FORCE so the table OWNER is also subject to RLS (owners bypass it
    -- otherwise). Production should still connect as a least-privilege role,
    -- but this makes the guarantee hold even if it doesn't.
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
    EXECUTE format($f$
      CREATE POLICY %1$s_scope ON %1$s
      FOR ALL
      USING (EXISTS (SELECT 1 FROM kwa.project p
                     WHERE p.id = %1$s.project_id
                       AND kwa.user_can_see_unit(p.org_unit_id)))
      WITH CHECK (EXISTS (SELECT 1 FROM kwa.project p
                     WHERE p.id = %1$s.project_id
                       AND kwa.user_can_see_unit(p.org_unit_id)));
    $f$, t);
  END LOOP;
END $$;

-- bill_line / bill_deduction / payment reference a bill, not a project
-- directly. Enable RLS and scope them via their bill's project. bill_line and
-- payment also carry a denormalized project_id (used by compute_bill / the
-- payments service); it's added here, before the policy references it.
ALTER TABLE bill_line ENABLE ROW LEVEL SECURITY;
ALTER TABLE bill_line FORCE ROW LEVEL SECURITY;
ALTER TABLE bill_deduction ENABLE ROW LEVEL SECURITY;
ALTER TABLE bill_deduction FORCE ROW LEVEL SECURITY;
ALTER TABLE payment ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment FORCE ROW LEVEL SECURITY;

ALTER TABLE bill_line ADD COLUMN IF NOT EXISTS project_id uuid;  -- denormalized for scope
CREATE POLICY bill_line_scope ON bill_line
  FOR ALL
  USING (EXISTS (SELECT 1 FROM kwa.bill b JOIN kwa.project p ON p.id = b.project_id
                 WHERE b.id = bill_line.bill_id
                   AND kwa.user_can_see_unit(p.org_unit_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM kwa.bill b JOIN kwa.project p ON p.id = b.project_id
                 WHERE b.id = bill_line.bill_id
                   AND kwa.user_can_see_unit(p.org_unit_id)));

DROP POLICY IF EXISTS bill_deduction_scope ON bill_deduction;
CREATE POLICY bill_deduction_scope ON bill_deduction
  FOR ALL
  USING (EXISTS (SELECT 1 FROM kwa.bill b JOIN kwa.project p ON p.id = b.project_id
                 WHERE b.id = bill_deduction.bill_id
                   AND kwa.user_can_see_unit(p.org_unit_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM kwa.bill b JOIN kwa.project p ON p.id = b.project_id
                 WHERE b.id = bill_deduction.bill_id
                   AND kwa.user_can_see_unit(p.org_unit_id)));

-- payment references a bill too
DROP POLICY IF EXISTS payment_scope ON payment;
ALTER TABLE payment ADD COLUMN IF NOT EXISTS project_id uuid;
CREATE POLICY payment_scope ON payment
  FOR ALL
  USING (EXISTS (SELECT 1 FROM kwa.bill b JOIN kwa.project p ON p.id = b.project_id
                 WHERE b.id = payment.bill_id
                   AND kwa.user_can_see_unit(p.org_unit_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM kwa.bill b JOIN kwa.project p ON p.id = b.project_id
                 WHERE b.id = payment.bill_id
                   AND kwa.user_can_see_unit(p.org_unit_id)));

-- Reference data (sor_*, deduction_*) stays globally readable; writes should be
-- limited to an admin DB role. Example (uncomment & set role):
--   ALTER TABLE sor_edition ENABLE ROW LEVEL SECURITY;
--   CREATE POLICY sor_read ON sor_edition FOR SELECT USING (true);
--   CREATE POLICY sor_write ON sor_edition FOR ALL TO kwa_admin USING (true) WITH CHECK (true);

COMMIT;
