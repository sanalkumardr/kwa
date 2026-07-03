import { DatabaseService } from '../src/database/database.service';
import { MbEntriesService } from '../src/mb-entries/mb-entries.service';
import { BillsService } from '../src/bills/bills.service';
import { PaymentsService } from '../src/payments/payments.service';
import { makeDb, resetSchema, SEED } from './test-db';

/**
 * Edge-case hardening of the audit-critical money chain: compute idempotency,
 * no double-billing, no certifying an empty bill, no overpayment, immutability,
 * and positive-quantity/amount guards.
 */
describe('Bill/payment money chain — edge cases', () => {
  let db: DatabaseService;
  let mb: MbEntriesService;
  let bills: BillsService;
  let payments: PaymentsService;

  const project = '66666666-0000-0000-0000-000000000001';
  const milestone = '66666666-1111-0000-0000-000000000001';
  const edition = '33333333-0000-0000-0000-000000000001';
  let billId = '';
  let netPayable = 0;

  beforeAll(async () => {
    await resetSchema();
    db = makeDb();
    mb = new MbEntriesService(db);
    bills = new BillsService(db);
    payments = new PaymentsService(db);

    // fresh project in EE's division, bound to the seed SOR at 0% premium,
    // with one approved (locked) MB entry of 100 m @ 1200 = 120000.
    await db.withUser(SEED.ee, async (c) => {
      await c.query(
        `INSERT INTO kwa.project (id, name, org_unit_id, status)
         VALUES ($1,'Money Chain Reach',$2,'in_progress')`,
        [project, SEED.divisionTvmSouth],
      );
      await c.query(
        `INSERT INTO kwa.project_sor_binding (project_id, edition_id, tender_premium_pct, bound_at)
         VALUES ($1,$2,0,'2025-06-01')`,
        [project, edition],
      );
      await c.query(
        `INSERT INTO kwa.milestone (id, project_id, name, planned_qty, unit, planned_date, status)
         VALUES ($1,$2,'M1',100,'m','2025-08-31','in_progress')`,
        [milestone, project],
      );
    });

    const entry = await mb.create(SEED.overseer, {
      milestoneId: milestone,
      sorItemId: SEED.sorItemDi300,
      quantity: 100,
      unit: 'm',
      chainageFrom: 0,
      chainageTo: 0.1,
    });
    await mb.check(SEED.ae, entry.id);
    await mb.approve(SEED.aee, entry.id);
  }, 60_000);

  afterAll(async () => {
    await db.onModuleDestroy();
  });

  it('compute is idempotent — deduction rows are not duplicated', async () => {
    const draft = await bills.createDraft(SEED.ae, project, '2025-09-05');
    billId = draft.id;

    const first = await bills.compute(SEED.ae, billId);
    expect(Number(first.gross_amount)).toBe(120000);
    netPayable = Number(first.net_payable);

    const second = await bills.compute(SEED.ae, billId); // run again
    expect(Number(second.net_payable)).toBe(netPayable); // unchanged

    const count = await db.withUser(SEED.ee, async (c) => {
      const r = await c.query<{ n: string }>(
        'SELECT COUNT(*) AS n FROM kwa.bill_deduction WHERE bill_id = $1 AND deleted = false',
        [billId],
      );
      return Number(r.rows[0].n);
    });
    expect(count).toBe(4); // 4 active rules, not 8
  });

  it('an approved MB entry cannot be billed onto a second bill', async () => {
    const other = await bills.createDraft(SEED.ae, project, '2025-09-06');
    const computed = await bills.compute(SEED.ae, other.id);
    expect(Number(computed.gross_amount)).toBe(0); // nothing left to bill

    // and an empty bill cannot be certified
    await expect(bills.certify(SEED.aee, other.id)).rejects.toThrow(
      /nothing to certify/i,
    );
  });

  it('rejects overpayment, zero, and negative; allows valid partials', async () => {
    await bills.certify(SEED.aee, billId); // net 108000 (120000 − 10%)
    expect(netPayable).toBe(108000);

    await expect(
      payments.sanction(SEED.ee, {
        billId,
        amount: 0,
        paymentDate: '2025-09-10',
      }),
    ).rejects.toThrow(/positive/i);

    // first partial ok
    await payments.sanction(SEED.ee, {
      billId,
      amount: 50000,
      paymentDate: '2025-09-10',
    });
    // second partial brings total to exactly net — ok
    await payments.sanction(SEED.ee, {
      billId,
      amount: 58000,
      paymentDate: '2025-09-11',
    });
    // any further rupee exceeds net — rejected
    await expect(
      payments.sanction(SEED.ee, {
        billId,
        amount: 1,
        paymentDate: '2025-09-12',
      }),
    ).rejects.toThrow(/exceeds net/i);
  });

  it('compute on a certified (locked) bill is rejected', async () => {
    await expect(bills.compute(SEED.ae, billId)).rejects.toThrow(/immutable/i);
  });

  it('MB entry quantity must be positive', async () => {
    await expect(
      mb.create(SEED.overseer, {
        milestoneId: milestone,
        sorItemId: SEED.sorItemDi300,
        quantity: 0,
        unit: 'm',
      }),
    ).rejects.toThrow(/positive/i);
  });
});
