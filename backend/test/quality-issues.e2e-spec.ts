import { DatabaseService } from '../src/database/database.service';
import { QualityService } from '../src/quality/quality.service';
import { IssuesService } from '../src/issues/issues.service';
import { makeDb, resetSchema, seedSecondDivision, SEED, OTHER } from './test-db';

describe('Quality tests & Issues', () => {
  let db: DatabaseService;
  let quality: QualityService;
  let issues: IssuesService;

  beforeAll(async () => {
    await resetSchema();
    db = makeDb();
    quality = new QualityService(db);
    issues = new IssuesService(db);
    await seedSecondDivision(db);
  }, 60_000);

  afterAll(async () => {
    await db.onModuleDestroy();
  });

  it('records and lists a quality test (RLS-scoped)', async () => {
    await quality.create(SEED.overseer, {
      projectId: SEED.projectA,
      testType: 'hydro',
      result: 'pass',
      value: '12 bar / 2h',
      testedAt: '2025-09-20',
    });
    const list = await quality.listByProject(SEED.ee, SEED.projectA);
    expect(list).toHaveLength(1);
    expect(list[0].result).toBe('pass');

    // another division cannot see it
    const other = await quality.listByProject(OTHER.userB, SEED.projectA);
    expect(other).toHaveLength(0);
  });

  it('raises a GPS-pinned issue and resolves it', async () => {
    const created = await issues.create(SEED.overseer, {
      projectId: SEED.projectA,
      title: 'Road cutting permit pending',
      priority: 'high',
      location: [77.0, 8.005],
    });
    expect(created.status).toBe('open');
    expect(created.lat).toBeCloseTo(8.005, 3);

    const open = await issues.listByProject(SEED.ee, SEED.projectA, 'open');
    expect(open.map((i) => i.id)).toContain(created.id);

    const resolved = await issues.setStatus(SEED.ae, created.id, 'resolved');
    expect(resolved.status).toBe('resolved');

    const stillOpen = await issues.listByProject(SEED.ee, SEED.projectA, 'open');
    expect(stillOpen.map((i) => i.id)).not.toContain(created.id);
  });
});
