import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import { DatabaseService } from '../src/database/database.service';
import { AuthService } from '../src/auth/auth.service';
import { LogOtpSender } from '../src/auth/otp-sender';
import { SyncService } from '../src/sync/sync.service';
import { PipelinesService } from '../src/pipelines/pipelines.service';
import { makeDb, resetSchema, SEED } from './test-db';

describe('OTP auth + GPS→chainage tagging', () => {
  let db: DatabaseService;
  let auth: AuthService;
  let sync: SyncService;
  let pipelines: PipelinesService;

  const project = '88888888-0000-0000-0000-000000000001';

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret';
    process.env.OTP_DEV_ECHO = 'true';
    await resetSchema();
    db = makeDb();
    const config = new ConfigService();
    auth = new AuthService(db, config, new LogOtpSender());
    sync = new SyncService(db);
    pipelines = new PipelinesService(db);

    // a project with a 2 km route in EE's division
    await db.withUser(SEED.ee, (c) =>
      c.query(
        `INSERT INTO kwa.project (id, name, org_unit_id, status)
         VALUES ($1,'Auth/GPS Reach',$2,'in_progress')`,
        [project, SEED.divisionTvmSouth],
      ),
    );
    await pipelines.createSegment(SEED.ee, {
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
    });
  }, 60_000);

  afterAll(async () => {
    await db.onModuleDestroy();
  });

  describe('OTP login', () => {
    it('issues a working JWT for the correct code', async () => {
      const req = await auth.requestOtp(SEED.eePhone);
      expect(req.devCode).toMatch(/^\d{6}$/);

      const { token, userId } = await auth.verifyOtp(SEED.eePhone, req.devCode!);
      expect(userId).toBe(SEED.ee);
      const payload = jwt.verify(token, 'test-secret') as jwt.JwtPayload;
      expect(payload.sub).toBe(SEED.ee);
    });

    it('rejects an incorrect code', async () => {
      await auth.requestOtp(SEED.eePhone);
      await expect(auth.verifyOtp(SEED.eePhone, '000000')).rejects.toThrow(
        /incorrect|code/i,
      );
    });

    it('does not leak whether an unknown phone exists', async () => {
      const req = await auth.requestOtp('9999999999');
      expect(req.sent).toBe(true); // success reported, but no code stored
      await expect(auth.verifyOtp('9999999999', '123456')).rejects.toThrow();
    });

    it('me() returns the authenticated user profile + role', async () => {
      const me = await auth.me(SEED.ee);
      expect(me.id).toBe(SEED.ee);
      expect(me.role).toBe('ee');
    });
  });

  describe('GPS auto-tags chainage on sync', () => {
    it('a DPR pushed with a GPS fix comes back chainage-tagged', async () => {
      const saved = await sync.upsertDpr(SEED.ee, {
        id: '88888888-dddd-0000-0000-000000000001',
        projectId: project,
        reportDate: '2025-09-15',
        weather: 'Clear',
        lengthLaidTodayM: 100,
        chainageReached: null,
        workDone: 'Laid pipe',
        workPlanned: null,
        blockers: null,
        status: 'draft',
        updatedAt: new Date().toISOString(),
        deleted: false,
        lat: 8.009, // midpoint of the route
        lng: 77.0,
      });

      expect(saved.chainage).toBeCloseTo(1.0, 3);
      expect(saved.segmentId).toBeTruthy();
      expect(saved.lat).toBeCloseTo(8.009, 3);
      expect(saved.lng).toBeCloseTo(77.0, 3);
    });

    it('a DPR with no GPS has null chainage', async () => {
      const saved = await sync.upsertDpr(SEED.ee, {
        id: '88888888-dddd-0000-0000-000000000002',
        projectId: project,
        reportDate: '2025-09-16',
        weather: null,
        lengthLaidTodayM: null,
        chainageReached: null,
        workDone: null,
        workPlanned: null,
        blockers: null,
        status: 'draft',
        updatedAt: new Date().toISOString(),
        deleted: false,
      });
      expect(saved.chainage).toBeNull();
      expect(saved.segmentId).toBeNull();
    });
  });
});
