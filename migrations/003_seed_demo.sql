-- =====================================================================
-- 003_seed_demo.sql — Reference + demo data and a worked bill.
-- DEV/DEMO ONLY. Do not run in production. Run after 002_rls.sql.
-- =====================================================================

BEGIN;
SET search_path = kwa, public;

-- =====================================================================
-- PART B — Seed reference data
-- =====================================================================

-- Org hierarchy: Authority > Circle > Division
INSERT INTO org_unit (id, name, level, parent_id, code) VALUES
  ('11111111-0000-0000-0000-000000000001','KWA HQ','authority',NULL,'KWA'),
  ('11111111-0000-0000-0000-000000000002','TVM Circle','circle','11111111-0000-0000-0000-000000000001','C-TVM'),
  ('11111111-0000-0000-0000-000000000003','TVM South Division','division','11111111-0000-0000-0000-000000000002','D-TVMS');

-- Users
INSERT INTO app_user (id, name, phone, role, home_unit_id) VALUES
  ('22222222-0000-0000-0000-000000000001','EE Menon','9000000001','ee','11111111-0000-0000-0000-000000000003'),
  ('22222222-0000-0000-0000-000000000002','AEE Nair','9000000002','aee','11111111-0000-0000-0000-000000000003'),
  ('22222222-0000-0000-0000-000000000003','AE Pillai','9000000003','ae','11111111-0000-0000-0000-000000000003'),
  ('22222222-0000-0000-0000-000000000004','Overseer Das','9000000004','overseer','11111111-0000-0000-0000-000000000003');

-- Scope: EE sees the whole division (and descendants)
INSERT INTO user_scope (user_id, org_unit_id) VALUES
  ('22222222-0000-0000-0000-000000000001','11111111-0000-0000-0000-000000000003'),
  ('22222222-0000-0000-0000-000000000002','11111111-0000-0000-0000-000000000003'),
  ('22222222-0000-0000-0000-000000000003','11111111-0000-0000-0000-000000000003'),
  ('22222222-0000-0000-0000-000000000004','11111111-0000-0000-0000-000000000003');

-- SOR edition + two items
INSERT INTO sor_edition (id, code, title, authority, effective_from, status) VALUES
  ('33333333-0000-0000-0000-000000000001','KWA-2025-26','KWA Schedule of Rates 2025-26','KWA','2025-04-01','published');
INSERT INTO sor_item (id, edition_id, item_code, description, unit, base_rate, chapter) VALUES
  ('33333333-1111-0000-0000-000000000001','33333333-0000-0000-0000-000000000001','WS-12.4','Laying DI pipe 300mm','m', 1200.00,'pipe-laying'),
  ('33333333-1111-0000-0000-000000000002','33333333-0000-0000-0000-000000000001','EW-3.1','Earthwork excavation in soil','m3',  250.00,'earthwork');

-- Deduction scheme + rules (IT 2%, GST TDS 2%, Security Deposit 5%, Labour cess 1%)
INSERT INTO deduction_type (id, code, name, direction, refundable) VALUES
  ('44444444-0000-0000-0000-000000000001','IT','Income Tax TDS','statutory',false),
  ('44444444-0000-0000-0000-000000000002','GST_TDS','GST TDS','statutory',false),
  ('44444444-0000-0000-0000-000000000003','SD','Security Deposit','recoverable',true),
  ('44444444-0000-0000-0000-000000000004','LABOUR_CESS','Labour Welfare Cess','statutory',false);

INSERT INTO deduction_scheme (id, code, effective_from, status) VALUES
  ('44444444-1111-0000-0000-000000000001','STATUTORY-2025','2025-04-01','active');

INSERT INTO deduction_rule (scheme_id, type_id, basis, rate_pct, calc_order) VALUES
  ('44444444-1111-0000-0000-000000000001','44444444-0000-0000-0000-000000000001','gross',2.0000,1),
  ('44444444-1111-0000-0000-000000000001','44444444-0000-0000-0000-000000000002','gross',2.0000,2),
  ('44444444-1111-0000-0000-000000000001','44444444-0000-0000-0000-000000000003','gross',5.0000,3),
  ('44444444-1111-0000-0000-000000000001','44444444-0000-0000-0000-000000000004','gross',1.0000,4);

-- =====================================================================
-- PART C — One project end-to-end, then compute a bill
-- =====================================================================

-- Identify as the EE for the inserts below (satisfies RLS + audit actor)
SELECT set_config('kwa.current_user_id','22222222-0000-0000-0000-000000000001', true);

-- Project in TVM South Division
INSERT INTO project (id, name, scheme, sanction_no, sanction_amount,
                     sanctioning_authority, as_date, ts_date, org_unit_id, status)
VALUES ('55555555-0000-0000-0000-000000000001','Neyyar WSS Reach-2','AMRUT 2.0',
        'AS/2025/417', 25000000.00,'KWA Board','2025-05-10','2025-05-20',
        '11111111-0000-0000-0000-000000000003','in_progress');

-- Bind to SOR edition with a +4.5% tender premium
INSERT INTO project_sor_binding (project_id, edition_id, tender_premium_pct, bound_at)
VALUES ('55555555-0000-0000-0000-000000000001','33333333-0000-0000-0000-000000000001',4.500,'2025-06-01');

-- A milestone
INSERT INTO milestone (id, project_id, name, chainage_from, chainage_to,
                       planned_qty, unit, planned_date, payment_percent, status)
VALUES ('55555555-1111-0000-0000-000000000001','55555555-0000-0000-0000-000000000001',
        'Reach-2 pipe laying km 0-2', 0.000, 2.000, 2000, 'm','2025-08-31',25.0,'in_progress');

-- MB entry: 1500 m of DI 300mm.
-- Effective rate = base 1200 * (1 + 4.5%) = 1254.00
INSERT INTO mb_entry (id, project_id, milestone_id, sor_item_id,
                      chainage_from, chainage_to, quantity, unit, rate_snapshot,
                      measured_by)
VALUES ('55555555-2222-0000-0000-000000000001','55555555-0000-0000-0000-000000000001',
        '55555555-1111-0000-0000-000000000001','33333333-1111-0000-0000-000000000001',
        0.000, 1.500, 1500, 'm', 1254.00,
        '22222222-0000-0000-0000-000000000004');
-- amount is generated: 1500 * 1254.00 = 1,881,000.00

-- AE checks, AEE approves -> locks (trigger sets locked_flag + approved_at)
UPDATE mb_entry SET checked_by = '22222222-0000-0000-0000-000000000003'
  WHERE id = '55555555-2222-0000-0000-000000000001';
UPDATE mb_entry SET approved_by = '22222222-0000-0000-0000-000000000002'
  WHERE id = '55555555-2222-0000-0000-000000000001';

-- Create the bill (draft)
INSERT INTO bill (id, project_id, running_bill_no, reference_date)
VALUES ('55555555-3333-0000-0000-000000000001','55555555-0000-0000-0000-000000000001',1,'2025-09-05');

-- ---------------------------------------------------------------------
-- Bill engine: pull approved MB entries into bill_line, compute deductions
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION kwa.compute_bill(p_bill uuid)
RETURNS void LANGUAGE plpgsql
-- Pin search_path: the function uses unqualified table names, and the app's
-- connection pool does not set a search_path, so without this it fails with
-- "relation bill does not exist".
SET search_path = kwa, public AS $$
DECLARE
  v_project uuid;
  v_refdate date;
  v_gross   numeric(14,2);
  v_scheme  uuid;
  r         record;
  v_total_ded numeric(14,2) := 0;
  v_amt     numeric(14,2);
BEGIN
  SELECT project_id, reference_date INTO v_project, v_refdate FROM bill WHERE id = p_bill;

  -- 1. pull every approved/locked MB entry not yet billed
  INSERT INTO bill_line (bill_id, mb_entry_id, quantity, rate, project_id)
  SELECT p_bill, m.id, m.quantity, m.rate_snapshot, m.project_id
  FROM mb_entry m
  WHERE m.project_id = v_project
    AND m.locked_flag = true
    AND m.deleted = false
    AND NOT EXISTS (SELECT 1 FROM bill_line bl WHERE bl.mb_entry_id = m.id);

  -- 2. gross = sum of bill lines
  SELECT COALESCE(SUM(amount),0) INTO v_gross
    FROM bill_line WHERE bill_id = p_bill AND deleted = false;

  -- 3. active deduction scheme for the bill reference date
  SELECT id INTO v_scheme FROM deduction_scheme
   WHERE status = 'active'
     AND effective_from <= v_refdate
     AND (effective_to IS NULL OR effective_to >= v_refdate)
   ORDER BY effective_from DESC LIMIT 1;

  -- 4. apply each rule in order, snapshotting code + rate.
  -- Soft-delete any prior deductions first so re-running compute is idempotent
  -- (a hard DELETE is blocked by the soft-delete-only trigger; reads filter
  -- deleted = false).
  UPDATE bill_deduction SET deleted = true
    WHERE bill_id = p_bill AND deleted = false;
  FOR r IN
    SELECT dr.*, dt.code AS type_code
    FROM deduction_rule dr JOIN deduction_type dt ON dt.id = dr.type_id
    WHERE dr.scheme_id = v_scheme AND dr.deleted = false
    ORDER BY dr.calc_order
  LOOP
    IF r.threshold_amount IS NOT NULL AND v_gross < r.threshold_amount THEN
      CONTINUE;
    END IF;
    v_amt := round(v_gross * r.rate_pct / 100.0, 2);
    IF r.cap_amount IS NOT NULL THEN v_amt := least(v_amt, r.cap_amount); END IF;
    INSERT INTO bill_deduction (bill_id, rule_id, type_code, basis_amount, rate_pct, amount)
    VALUES (p_bill, r.id, r.type_code, v_gross, r.rate_pct, v_amt);
    v_total_ded := v_total_ded + v_amt;
  END LOOP;

  -- 5. write totals back (net_payable is generated)
  UPDATE bill SET gross_amount = v_gross, total_deductions = v_total_ded
   WHERE id = p_bill;
END $$;

SELECT kwa.compute_bill('55555555-3333-0000-0000-000000000001');

-- Certify the bill -> trigger locks it
UPDATE bill SET certified_by = '22222222-0000-0000-0000-000000000002'
  WHERE id = '55555555-3333-0000-0000-000000000001';


-- =====================================================================
-- Verification queries (run after the script)
-- =====================================================================
-- Expected: gross 1,881,000.00 ; deductions IT 37,620 + GST 37,620
--           + SD 94,050 + cess 18,810 = 188,100.00 ; net 1,692,900.00
--
-- SELECT running_bill_no, gross_amount, total_deductions, net_payable, status
-- FROM kwa.bill WHERE id = '55555555-3333-0000-0000-000000000001';
--
-- SELECT type_code, basis_amount, rate_pct, amount
-- FROM kwa.bill_deduction WHERE bill_id = '55555555-3333-0000-0000-000000000001'
-- ORDER BY amount DESC;
--
-- -- Proof of immutability (should ERROR):
-- UPDATE kwa.mb_entry SET quantity = 9999
--   WHERE id = '55555555-2222-0000-0000-000000000001';
-- UPDATE kwa.bill SET gross_amount = 0
--   WHERE id = '55555555-3333-0000-0000-000000000001';

COMMIT;
