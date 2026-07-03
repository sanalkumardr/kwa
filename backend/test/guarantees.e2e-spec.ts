import { DatabaseService } from '../src/database/database.service';
import { ProjectsService } from '../src/projects/projects.service';
import { SyncService } from '../src/sync/sync.service';
import { PaymentsService } from '../src/payments/payments.service';
import { MbEntriesService } from '../src/mb-entries/mb-entries.service';
import { BillsService } from '../src/bills/bills.service';
import {
  makeDb,
  resetSchema,
  seedSecondDivision,
  SEED,
  OTHER,
} from './test-db';

/**
 * End-to-end proof of the guarantees the whole design rests on. These run
 * against a real Postgres+PostGIS (TEST_DATABASE_URL) so RLS, triggers and the
 * compute_bill function are exercised for real — not mocked.
 */
describe('KWA backend guarantees', () => {
  let db: DatabaseService;
  let projects: ProjectsService;
  let sync: SyncService;
  let payments: PaymentsService;
  let mb: MbEntriesService;
  let bills: BillsService;

  beforeAll(async () => {
    await resetSchema();
    db = makeDb();
    projects = new ProjectsService(db);
    sync = new SyncService(db);
    payments = new PaymentsService(db);
    mb = new MbEntriesService(db);
    bills = new BillsService(db);
    await seedSecondDivision(db);
  }, 60_000);

  afterAll(async () => {
    await db.onModuleDestroy();
  });

  describe('RLS isolation between divisions', () => {
    it('EE sees their own division project but not another division', async () => {
      const ids = (await projects.list(SEED.ee)).map((p) => p.id);
      expect(ids).toContain(SEED.projectA);
      expect(ids).not.toContain(OTHER.projectB);
    });

    it('the other-division user sees only their project', async () => {
      const ids = (await projects.list(OTHER.userB)).map((p) => p.id);
      expect(ids).toContain(OTHER.projectB);
      expect(ids).not.toContain(SEED.projectA);
    });
  });

  describe('Sync is RLS-scoped', () => {
    it('a DPR pushed in division A is invisible to division B', async () => {
      await sync.upsertDpr(SEED.ee, {
        id: '55555555-dddd-0000-0000-000000000001',
        projectId: SEED.projectA,
        reportDate: '2025-09-10',
        weather: 'Clear',
        lengthLaidTodayM: 120,
        chainageReached: 1.5,
        workDone: 'Laid DI 300mm',
        workPlanned: 'Continue',
        blockers: null,
        status: 'draft',
        updatedAt: new Date().toISOString(),
        deleted: false,
      });

      const seenByA = (await sync.pullDpr(SEED.ee, null)).map((d) => d.id);
      expect(seenByA).toContain('55555555-dddd-0000-0000-000000000001');

      const seenByB = (await sync.pullDpr(OTHER.userB, null)).map((d) => d.id);
      expect(seenByB).not.toContain('55555555-dddd-0000-0000-000000000001');
    });

    it('watermarked pull only returns rows newer than `since`', async () => {
      const future = new Date(Date.now() + 60_000).toISOString();
      const none = await sync.pullDpr(SEED.ee, future);
      expect(none).toHaveLength(0);
    });
  });

  describe('Immutability of approved/certified records', () => {
    it('a locked (approved) MB entry cannot be modified', async () => {
      await expect(
        db.withUser(SEED.ee, (c) =>
          c.query('UPDATE kwa.mb_entry SET quantity = 9999 WHERE id = $1', [
            SEED.lockedMbA,
          ]),
        ),
      ).rejects.toThrow(/locked/i);
    });

    it('a certified bill cannot have its amounts changed', async () => {
      await expect(
        db.withUser(SEED.ee, (c) =>
          c.query('UPDATE kwa.bill SET gross_amount = 0 WHERE id = $1', [
            SEED.billA,
          ]),
        ),
      ).rejects.toThrow(/immutable/i);
    });
  });

  describe('Bills list', () => {
    it('lists the seeded bill for project A', async () => {
      const list = await bills.listByProject(SEED.ee, SEED.projectA);
      expect(list.map((b) => b.id)).toContain(SEED.billA);
    });
  });

  describe('compute_bill correctness (from seed)', () => {
    it('bill A nets 16,92,900 after statutory deductions', async () => {
      const row = await db.withUser(SEED.ee, async (c) => {
        const r = await c.query<{
          gross_amount: string;
          total_deductions: string;
          net_payable: string;
        }>(
          `SELECT gross_amount, total_deductions, net_payable
           FROM kwa.bill WHERE id = $1`,
          [SEED.billA],
        );
        return r.rows[0];
      });
      expect(row.gross_amount).toBe('1881000.00');
      expect(row.total_deductions).toBe('188100.00');
      expect(row.net_payable).toBe('1692900.00');
    });
  });

  describe('Payment lifecycle (certified → paid exception)', () => {
    it('sanctioning payment flips the bill to paid, then it locks again', async () => {
      const p = await payments.sanction(SEED.ee, {
        billId: SEED.billA,
        amount: 1692900,
        paymentDate: '2025-09-12',
        reference: 'PFMS-TEST-1',
      });
      expect(Number(p.amount)).toBe(1692900);

      const status = await db.withUser(SEED.ee, async (c) => {
        const r = await c.query<{ status: string }>(
          'SELECT status FROM kwa.bill WHERE id = $1',
          [SEED.billA],
        );
        return r.rows[0].status;
      });
      expect(status).toBe('paid');

      // any further change to the locked, now-paid bill is rejected
      await expect(
        db.withUser(SEED.ee, (c) =>
          c.query("UPDATE kwa.bill SET status = 'draft' WHERE id = $1", [
            SEED.billA,
          ]),
        ),
      ).rejects.toThrow(/immutable/i);
    });
  });

  describe('MB workflow + rate derivation + lock', () => {
    it('creates an MB entry with SOR rate*premium, then locks on approval', async () => {
      // SOR base 1200 * (1 + 4.5%) = 1254.00; qty 100 => amount 125400.00
      const created = await mb.create(SEED.overseer, {
        milestoneId: SEED.milestoneA,
        sorItemId: SEED.sorItemDi300,
        quantity: 100,
        unit: 'm',
        chainageFrom: 1.5,
        chainageTo: 1.6,
      });
      expect(created.rate_snapshot).toBe('1254.00');
      expect(created.amount).toBe('125400.00');
      expect(created.locked_flag).toBe(false);

      await mb.check(SEED.ae, created.id);
      const approved = await mb.approve(SEED.aee, created.id);
      expect(approved.locked_flag).toBe(true);

      await expect(
        db.withUser(SEED.ee, (c) =>
          c.query('UPDATE kwa.mb_entry SET quantity = 1 WHERE id = $1', [
            created.id,
          ]),
        ),
      ).rejects.toThrow(/locked/i);
    });

    it('refuses approval before an AE check', async () => {
      const created = await mb.create(SEED.overseer, {
        milestoneId: SEED.milestoneA,
        sorItemId: SEED.sorItemDi300,
        quantity: 10,
        unit: 'm',
      });
      await expect(mb.approve(SEED.aee, created.id)).rejects.toThrow(
        /checked/i,
      );
    });
  });

  describe('Role enforcement (server-side authority)', () => {
    it('an overseer cannot approve an MB entry', async () => {
      const created = await mb.create(SEED.overseer, {
        milestoneId: SEED.milestoneA,
        sorItemId: SEED.sorItemDi300,
        quantity: 5,
        unit: 'm',
      });
      await mb.check(SEED.ae, created.id);
      await expect(mb.approve(SEED.overseer, created.id)).rejects.toThrow(
        /role/i,
      );
    });

    it('an AE cannot certify a bill (needs AEE+)', async () => {
      const draft = await bills.createDraft(
        SEED.ae,
        SEED.projectA,
        '2025-10-01',
      );
      await expect(bills.certify(SEED.ae, draft.id)).rejects.toThrow(/role/i);
    });

    it('an AEE cannot sanction a payment (needs EE)', async () => {
      await expect(
        payments.sanction(SEED.aee, {
          billId: SEED.billA,
          amount: 1,
          paymentDate: '2025-10-02',
        }),
      ).rejects.toThrow(/role/i);
    });
  });
});
