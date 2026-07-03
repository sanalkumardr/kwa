import { DatabaseService } from '../src/database/database.service';
import { PipelinesService } from '../src/pipelines/pipelines.service';
import { makeDb, resetSchema, SEED } from './test-db';

/**
 * Phase 1 GIS layer: chainage math and planned-vs-actual progress, exercised
 * against real PostGIS.
 */
describe('Pipeline chainage (Phase 1)', () => {
  let db: DatabaseService;
  let pipelines: PipelinesService;

  // a fresh project in EE's division (deterministic: no MB entries)
  const project = '77777777-0000-0000-0000-000000000001';

  beforeAll(async () => {
    await resetSchema();
    db = makeDb();
    pipelines = new PipelinesService(db);
    await db.withUser(SEED.ee, (c) =>
      c.query(
        `INSERT INTO kwa.project (id, name, org_unit_id, status)
         VALUES ($1,'Chainage Test Reach',$2,'in_progress')`,
        [project, SEED.divisionTvmSouth],
      ),
    );
  }, 60_000);

  afterAll(async () => {
    await db.onModuleDestroy();
  });

  it('stores a route segment and returns it as GeoJSON', async () => {
    const seg = await pipelines.createSegment(SEED.ee, {
      projectId: project,
      name: 'Reach A',
      geometry: {
        type: 'LineString',
        coordinates: [
          [77.0, 8.0],
          [77.0, 8.018],
        ],
      },
      chainageFrom: 0,
      chainageTo: 2,
      diameterMm: 300,
      material: 'DI',
    });
    expect(seg.id).toBeDefined();
    expect(seg.geojson).toContain('LineString');

    const list = await pipelines.listSegments(SEED.ee, project);
    expect(list).toHaveLength(1);
  });

  it('maps a GPS point to chainage along the route', async () => {
    // midpoint of the line → fraction 0.5 → chainage 0 + 0.5 * (2 - 0) = 1.000
    const res = await pipelines.locate(SEED.ee, project, 77.0, 8.009);
    expect(res).not.toBeNull();
    expect(res!.chainage).toBeCloseTo(1.0, 3);
    expect(res!.distanceM).toBeLessThan(1); // essentially on the line
  });

  it('reports planned km from geometry and 0% with no approved MB', async () => {
    const p = await pipelines.progress(SEED.ee, project);
    expect(p.plannedKm).toBe(2);
    expect(p.actualKm).toBe(0);
    expect(p.physicalPercent).toBe(0);
  });

  it('counts approved MB chainage as actual laid length', async () => {
    // seed project A has one locked MB entry spanning chainage 0.0 → 1.5
    const p = await pipelines.progress(SEED.ee, SEED.projectA);
    expect(p.actualKm).toBe(1.5);
  });
});
