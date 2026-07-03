import { DatabaseService } from '../src/database/database.service';
import { ReportsService } from '../src/reports/reports.service';
import { DocumentsService } from '../src/documents/documents.service';
import { makeDb, resetSchema, seedSecondDivision, SEED, OTHER } from './test-db';

describe('Phase 4 — rollup, audit export, documents', () => {
  let db: DatabaseService;
  let reports: ReportsService;
  let docs: DocumentsService;

  beforeAll(async () => {
    await resetSchema();
    db = makeDb();
    reports = new ReportsService(db);
    docs = new DocumentsService(db);
    await seedSecondDivision(db);
  }, 60_000);

  afterAll(async () => {
    await db.onModuleDestroy();
  });

  describe('Division rollup', () => {
    it('includes the seeded project with financial + physical metrics', async () => {
      const rows = await reports.rollup(SEED.ee);
      const a = rows.find((r) => r.projectId === SEED.projectA);
      expect(a).toBeDefined();
      // seeded MB spans 0→1.5 km; bill A certified net 16,92,900
      expect(a!.laidKm).toBe(1.5);
      expect(a!.certifiedNet).toBe(1692900);
    });

    it('is RLS-scoped: other division does not see project A', async () => {
      const rows = await reports.rollup(OTHER.userB);
      expect(rows.map((r) => r.projectId)).not.toContain(SEED.projectA);
    });

    it('narrows to an org subtree when orgUnitId is given', async () => {
      const rows = await reports.rollup(SEED.ee, SEED.divisionTvmSouth);
      expect(rows.every((r) => r.orgUnitId === SEED.divisionTvmSouth)).toBe(true);
    });
  });

  describe('Audit export', () => {
    it('returns the audit chain for the project (create + lock events)', async () => {
      const trail = await reports.auditExport(SEED.ee, SEED.projectA);
      expect(trail.length).toBeGreaterThan(0);
      const tables = new Set(trail.map((t) => t.entity_table));
      expect(tables.has('project')).toBe(true);
      expect(tables.has('mb_entry')).toBe(true);
      // approval of the seeded MB produced a 'lock' action
      expect(trail.some((t) => t.action === 'lock')).toBe(true);
    });
  });

  describe('Documents & expiry', () => {
    it('registers documents and flags expiring permits', async () => {
      await docs.create(SEED.overseer, {
        projectId: SEED.projectA,
        kind: 'drawing',
        storageKey: 'drawing/ga-v1.pdf',
      });
      await docs.create(SEED.overseer, {
        projectId: SEED.projectA,
        kind: 'permit',
        storageKey: 'permit/road-cut.pdf',
        expiresOn: new Date(Date.now() + 10 * 86400_000)
          .toISOString()
          .slice(0, 10), // expires in 10 days
      });

      const all = await docs.listByProject(SEED.ee, SEED.projectA);
      expect(all).toHaveLength(2);

      const soon = await docs.expiring(SEED.ee, SEED.projectA, 30);
      expect(soon.map((d) => d.kind)).toEqual(['permit']);

      const none = await docs.expiring(SEED.ee, SEED.projectA, 5);
      expect(none).toHaveLength(0); // permit is 10 days out, beyond 5
    });
  });
});
