// Standalone DB-guarantee validation against a REAL PostgreSQL where PostGIS is
// unavailable. It applies migrations 001/002/003/005 with geometry stubbed to a
// text domain (the core migrations use geometry only as column *types*, no ST_
// functions), then asserts the database-enforced guarantees: RLS isolation,
// lock-after-approval immutability, certified→paid, compute_bill correctness +
// idempotency, generated columns, audit log, soft-delete blocking.
//
// This is a complement to the full jest suite (which needs PostGIS and runs in
// CI). It found three real bugs that parse/typecheck missed — see
// backend/README.md "Live validation".
//
// Usage (with @embedded-postgres binaries on PATH and a server on $SOCK):
//   node test/validate-no-postgis.js
const fs = require('fs');
const { Client } = require('pg');
const SOCK = process.env.PGSOCK || '/tmp/pgtest/sock';
const path = require('path');
const MIG = process.env.MIG_DIR || path.join(__dirname, '..', '..', 'migrations');
const ID = {
  div: '11111111-0000-0000-0000-000000000003',
  ee: '22222222-0000-0000-0000-000000000001',
  aee: '22222222-0000-0000-0000-000000000002',
  ae: '22222222-0000-0000-0000-000000000003',
  ovr: '22222222-0000-0000-0000-000000000004',
  pA: '55555555-0000-0000-0000-000000000001',
  mA: '55555555-1111-0000-0000-000000000001',
  mbA: '55555555-2222-0000-0000-000000000001',
  billA: '55555555-3333-0000-0000-000000000001',
  sor: '33333333-1111-0000-0000-000000000001',
  ed: '33333333-0000-0000-0000-000000000001',
};
const stub = (s) => s.split('\n').filter(l => !/CREATE EXTENSION/.test(l)).join('\n')
  .replace(/geometry\([^)]*\)/g, 'geometry').replace(/ USING gist/g, '');
let pass = 0, fail = 0;
const ok = (n) => { console.log('  PASS', n); pass++; };
const no = (n, e) => { console.log('  FAIL', n, '—', e); fail++; };

(async () => {
  // 1. role + db as superuser
  let su = new Client({ host: SOCK, user: 'postgres', database: 'postgres' });
  await su.connect();
  await su.query('DROP DATABASE IF EXISTS kwa_test');
  await su.query('DROP ROLE IF EXISTS kwa_app');
  await su.query('CREATE ROLE kwa_app LOGIN NOSUPERUSER NOBYPASSRLS');
  await su.query('CREATE DATABASE kwa_test OWNER kwa_app');
  await su.end();

  // geometry shim + ST_ stubs in the test db (superuser)
  su = new Client({ host: SOCK, user: 'postgres', database: 'kwa_test' });
  await su.connect();
  await su.query('CREATE DOMAIN public.geometry AS text');
  await su.query("CREATE FUNCTION public.st_makepoint(float8,float8) RETURNS text LANGUAGE sql AS $$ SELECT NULL::text $$");
  await su.query("CREATE FUNCTION public.st_setsrid(text,int) RETURNS text LANGUAGE sql AS $$ SELECT $1 $$");
  await su.end();

  // 2. apply migrations as kwa_app (non-superuser → FORCE RLS binds)
  const app = new Client({ host: SOCK, user: 'kwa_app', database: 'kwa_test' });
  await app.connect();
  for (const f of ['001_schema.sql', '002_rls.sql', '003_seed_demo.sql', '005_auth_dpr_gps.sql']) {
    await app.query(stub(fs.readFileSync(`${MIG}/${f}`, 'utf8')));
  }
  console.log('migrations applied (001/002/003/005, geometry stubbed)\n');

  const withUser = async (uid, fn) => {
    await app.query('BEGIN');
    await app.query("SELECT set_config('kwa.current_user_id',$1,true)", [uid]);
    try { const r = await fn(); await app.query('COMMIT'); return r; }
    catch (e) { await app.query('ROLLBACK'); throw e; }
  };
  const rejects = async (name, uid, sql, args, re) => {
    try { await withUser(uid, () => app.query(sql, args)); no(name, 'no error thrown'); }
    catch (e) { re.test(e.message) ? ok(name) : no(name, e.message); }
  };

  // seed a second division (org/user/scope not RLS; project via userB)
  await app.query(`INSERT INTO kwa.org_unit(id,name,level,parent_id,code) VALUES('99999999-0000-0000-0000-0000000000b0','North','division','11111111-0000-0000-0000-000000000002','DN')`);
  await app.query(`INSERT INTO kwa.app_user(id,name,phone,role,home_unit_id) VALUES('99999999-0000-0000-0000-0000000000b1','EEN','9111','ee','99999999-0000-0000-0000-0000000000b0')`);
  await app.query(`INSERT INTO kwa.user_scope(user_id,org_unit_id) VALUES('99999999-0000-0000-0000-0000000000b1','99999999-0000-0000-0000-0000000000b0')`);
  await withUser('99999999-0000-0000-0000-0000000000b1', () =>
    app.query(`INSERT INTO kwa.project(id,name,org_unit_id,status) VALUES('99999999-0000-0000-0000-0000000000b2','North R1','99999999-0000-0000-0000-0000000000b0','in_progress')`));

  // CHECK 1: RLS isolation
  try {
    const a = await withUser(ID.ee, () => app.query('SELECT id FROM kwa.project'));
    const b = await withUser('99999999-0000-0000-0000-0000000000b1', () => app.query('SELECT id FROM kwa.project'));
    const aIds = a.rows.map(r => r.id), bIds = b.rows.map(r => r.id);
    (aIds.includes(ID.pA) && !aIds.includes('99999999-0000-0000-0000-0000000000b2')
      && bIds.includes('99999999-0000-0000-0000-0000000000b2') && !bIds.includes(ID.pA))
      ? ok('RLS isolates projects by division') : no('RLS isolation', JSON.stringify({aIds, bIds}));
  } catch (e) { no('RLS isolation', e.message); }

  // CHECK 2: compute_bill correctness (from seed)
  try {
    const r = await withUser(ID.ee, () => app.query('SELECT gross_amount,total_deductions,net_payable FROM kwa.bill WHERE id=$1', [ID.billA]));
    const x = r.rows[0];
    (x.gross_amount === '1881000.00' && x.total_deductions === '188100.00' && x.net_payable === '1692900.00')
      ? ok('compute_bill: gross/deductions/net correct') : no('compute_bill totals', JSON.stringify(x));
  } catch (e) { no('compute_bill totals', e.message); }

  // CHECK 3: locked MB entry immutable
  await rejects('locked MB entry rejects UPDATE', ID.ee, 'UPDATE kwa.mb_entry SET quantity=9999 WHERE id=$1', [ID.mbA], /locked/i);

  // CHECK 4: certified bill immutable
  await rejects('certified bill rejects amount change', ID.ee, 'UPDATE kwa.bill SET gross_amount=0 WHERE id=$1', [ID.billA], /immutable/i);

  // CHECK 5: hard delete blocked
  await rejects('hard DELETE blocked (soft-delete only)', ID.ee, 'DELETE FROM kwa.project WHERE id=$1', [ID.pA], /forbidden|hard delete/i);

  // CHECK 6: audit_log populated + insert-only
  try {
    const c = await withUser(ID.ee, () => app.query('SELECT count(*)::int n FROM kwa.audit_log'));
    if (c.rows[0].n > 0) ok(`audit_log populated (${c.rows[0].n} rows)`); else no('audit_log populated', 'empty');
  } catch (e) { no('audit_log populated', e.message); }
  await rejects('audit_log is insert-only', ID.ee, 'UPDATE kwa.audit_log SET action=$1 WHERE true', ['x'], /immutable|insert-only/i);

  // CHECK 7: compute_bill idempotency on a fresh project
  try {
    await withUser(ID.ee, async () => {
      await app.query(`INSERT INTO kwa.project(id,name,org_unit_id,status) VALUES('66666666-0000-0000-0000-000000000001','MC',$1,'in_progress')`, [ID.div]);
      await app.query(`INSERT INTO kwa.project_sor_binding(project_id,edition_id,tender_premium_pct,bound_at) VALUES('66666666-0000-0000-0000-000000000001',$1,0,'2025-06-01')`, [ID.ed]);
      await app.query(`INSERT INTO kwa.milestone(id,project_id,name,planned_qty,unit,planned_date,status) VALUES('66666666-1111-0000-0000-000000000001','66666666-0000-0000-0000-000000000001','M',100,'m','2025-08-31','in_progress')`);
      await app.query(`INSERT INTO kwa.mb_entry(id,project_id,milestone_id,sor_item_id,chainage_from,chainage_to,quantity,unit,rate_snapshot,measured_by) VALUES('66666666-2222-0000-0000-000000000001','66666666-0000-0000-0000-000000000001','66666666-1111-0000-0000-000000000001',$1,0,0.1,100,'m',1200,$2)`, [ID.sor, ID.ovr]);
      await app.query(`UPDATE kwa.mb_entry SET checked_by=$1 WHERE id='66666666-2222-0000-0000-000000000001'`, [ID.ae]);
      await app.query(`UPDATE kwa.mb_entry SET approved_by=$1 WHERE id='66666666-2222-0000-0000-000000000001'`, [ID.aee]);
      await app.query(`INSERT INTO kwa.bill(id,project_id,running_bill_no,reference_date) VALUES('66666666-3333-0000-0000-000000000001','66666666-0000-0000-0000-000000000001',1,'2025-09-05')`);
    });
    const net1 = await withUser(ID.ee, async () => { await app.query("SELECT kwa.compute_bill('66666666-3333-0000-0000-000000000001')"); const r = await app.query("SELECT net_payable FROM kwa.bill WHERE id='66666666-3333-0000-0000-000000000001'"); return r.rows[0].net_payable; });
    const cnt = await withUser(ID.ee, async () => { await app.query("SELECT kwa.compute_bill('66666666-3333-0000-0000-000000000001')"); const r = await app.query("SELECT count(*)::int n FROM kwa.bill_deduction WHERE bill_id='66666666-3333-0000-0000-000000000001' AND deleted=false"); return r.rows[0].n; });
    // generated amount check
    const amt = await withUser(ID.ee, () => app.query("SELECT amount FROM kwa.mb_entry WHERE id='66666666-2222-0000-0000-000000000001'"));
    if (amt.rows[0].amount === '120000.00') ok('generated column: mb amount = qty*rate'); else no('generated amount', amt.rows[0].amount);
    if (cnt === 4) ok('compute_bill idempotent: 4 deduction rows after 2 runs'); else no('compute_bill idempotency', `rows=${cnt}`);
    if (net1 === '108000.00') ok('compute_bill net on fresh bill = 108000'); else no('fresh bill net', net1);
  } catch (e) { no('compute_bill idempotency setup', e.message); }

  // CHECK 8: certified -> paid allowed, then locked
  try {
    const u = await withUser(ID.ee, () => app.query("UPDATE kwa.bill SET status='paid' WHERE id=$1 AND status='certified'", [ID.billA]));
    if (u.rowCount === 1) ok('certified -> paid transition allowed'); else no('certified->paid', `rowCount=${u.rowCount}`);
  } catch (e) { no('certified->paid', e.message); }
  await rejects('paid bill still immutable (status->draft blocked)', ID.ee, "UPDATE kwa.bill SET status='draft' WHERE id=$1", [ID.billA], /immutable/i);

  await app.end();
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e.message); process.exit(2); });
