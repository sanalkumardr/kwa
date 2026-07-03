// App-layer validation: runs the REAL compiled NestJS services against a live
// PostgreSQL (PostGIS stubbed) to exercise logic the SQL-only harness can't —
// role enforcement, MB rate derivation, the certify/overpayment guards.
//
// It found a production bug the SQL harness masked: compute_bill used unqualified
// table names and relied on the session search_path including `kwa`. The app's
// connection pool sets no search_path, so it failed with "relation bill does not
// exist" — fixed by pinning the function's search_path. See backend/README.md.
//
// Prereq: `npm run build` (populates dist/), and a PostgreSQL reachable at
// DATABASE_URL (default localhost:5433) where the connecting role can create the
// kwa_test database — e.g. the @embedded-postgres binary used in dev.
//
// Usage: node test/validate-services.js
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { ConfigService } = require('@nestjs/config');

const MIG = process.env.MIG_DIR || path.join(__dirname, '..', '..', 'migrations');
const HOST = process.env.PGHOST || '127.0.0.1';
const PORT = Number(process.env.PGPORT || 5433);
process.env.DATABASE_URL =
  process.env.DATABASE_URL || `postgresql://kwa_app@${HOST}:${PORT}/kwa_test`;

const { DatabaseService } = require('../dist/database/database.service');
const { MbEntriesService } = require('../dist/mb-entries/mb-entries.service');
const { BillsService } = require('../dist/bills/bills.service');
const { PaymentsService } = require('../dist/payments/payments.service');

const ID = {
  div: '11111111-0000-0000-0000-000000000003',
  ee: '22222222-0000-0000-0000-000000000001',
  aee: '22222222-0000-0000-0000-000000000002',
  ae: '22222222-0000-0000-0000-000000000003',
  ovr: '22222222-0000-0000-0000-000000000004',
  pA: '55555555-0000-0000-0000-000000000001',
  mA: '55555555-1111-0000-0000-000000000001',
  sor: '33333333-1111-0000-0000-000000000001',
};
const stub = (s) => s.split('\n').filter((l) => !/CREATE EXTENSION/.test(l)).join('\n')
  .replace(/geometry\([^)]*\)/g, 'geometry').replace(/ USING gist/g, '');
let pass = 0, fail = 0;
const ok = (n) => { console.log('  PASS', n); pass++; };
const no = (n, e) => { console.log('  FAIL', n, '—', e); fail++; };
const rej = async (n, fn, re) => {
  try { await fn(); no(n, 'no error'); } catch (e) { re.test(e.message) ? ok(n) : no(n, e.message); }
};

(async () => {
  let su = new Client({ host: HOST, port: PORT, user: 'postgres', database: 'postgres' });
  await su.connect();
  await su.query('DROP DATABASE IF EXISTS kwa_test');
  await su.query('DROP ROLE IF EXISTS kwa_app');
  await su.query('CREATE ROLE kwa_app LOGIN NOSUPERUSER NOBYPASSRLS');
  await su.query('CREATE DATABASE kwa_test OWNER kwa_app');
  await su.end();
  su = new Client({ host: HOST, port: PORT, user: 'postgres', database: 'kwa_test' });
  await su.connect();
  await su.query('CREATE DOMAIN public.geometry AS text');
  await su.query("CREATE FUNCTION public.st_makepoint(float8,float8) RETURNS text LANGUAGE sql AS $$ SELECT NULL::text $$");
  await su.query("CREATE FUNCTION public.st_setsrid(text,int) RETURNS text LANGUAGE sql AS $$ SELECT $1 $$");
  await su.end();
  const setup = new Client({ host: HOST, port: PORT, user: 'kwa_app', database: 'kwa_test' });
  await setup.connect();
  for (const f of ['001_schema.sql', '002_rls.sql', '003_seed_demo.sql', '005_auth_dpr_gps.sql'])
    await setup.query(stub(fs.readFileSync(`${MIG}/${f}`, 'utf8')));
  await setup.end();
  console.log('migrations applied; exercising REAL compiled services\n');

  const db = new DatabaseService(new ConfigService());
  db.onModuleInit();
  const mb = new MbEntriesService(db), bills = new BillsService(db), pay = new PaymentsService(db);

  let entry;
  try {
    entry = await mb.create(ID.ovr, { milestoneId: ID.mA, sorItemId: ID.sor, quantity: 50, unit: 'm', chainageFrom: 2, chainageTo: 2.05 });
    (entry.rate_snapshot === '1254.00' && entry.amount === '62700.00')
      ? ok('MB deriveRate: 1200×1.045=1254, amount 62700') : no('deriveRate', JSON.stringify(entry));
  } catch (e) { no('deriveRate', e.message); }

  await rej('overseer cannot approve MB', () => mb.approve(ID.ovr, entry.id), /role/i);
  try {
    await mb.check(ID.ae, entry.id);
    const ap = await mb.approve(ID.aee, entry.id);
    ap.locked_flag === true ? ok('AE check + AEE approve locks entry') : no('approve locks', `${ap.locked_flag}`);
  } catch (e) { no('check/approve', e.message); }

  let bid;
  try {
    const d = await bills.createDraft(ID.ae, ID.pA, '2025-10-01');
    bid = d.id;
    const c = await bills.compute(ID.ae, bid);
    Number(c.gross_amount) === 62700 ? ok('compute pulls approved MB (gross 62700)') : no('compute gross', c.gross_amount);
  } catch (e) { no('createDraft/compute', e.message); }
  await rej('AE cannot certify bill', () => bills.certify(ID.ae, bid), /role/i);
  try {
    const cert = await bills.certify(ID.aee, bid);
    cert.status === 'certified' ? ok('AEE certifies bill') : no('certify', cert.status);
  } catch (e) { no('certify aee', e.message); }

  await rej('AEE cannot sanction payment', () => pay.sanction(ID.aee, { billId: bid, amount: 1, paymentDate: '2025-10-02' }), /role/i);
  await rej('zero payment rejected', () => pay.sanction(ID.ee, { billId: bid, amount: 0, paymentDate: '2025-10-02' }), /positive/i);
  await rej('overpayment rejected', () => pay.sanction(ID.ee, { billId: bid, amount: 999999, paymentDate: '2025-10-02' }), /exceeds/i);
  try {
    const p = await pay.sanction(ID.ee, { billId: bid, amount: 56430, paymentDate: '2025-10-02' });
    Number(p.amount) === 56430 ? ok('EE sanctions exact net payment') : no('sanction', p.amount);
  } catch (e) { no('sanction ee', e.message); }

  await db.onModuleDestroy();
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR:', e.message); process.exit(2); });
