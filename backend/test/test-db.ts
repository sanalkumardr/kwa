import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../src/database/database.service';

/**
 * Test database harness.
 *
 * Requires a Postgres (with PostGIS) reachable at TEST_DATABASE_URL. The CI/dev
 * role should OWN the schema (so it can drop/recreate it); because migration
 * 002 sets FORCE ROW LEVEL SECURITY, RLS is enforced even for the owner — which
 * is exactly what makes these tests meaningful.
 *
 * `resetSchema()` drops the kwa schema and re-applies 001/002/003 for a clean,
 * deterministic starting state (003 seeds the TVM South division + a locked MB
 * entry + a certified bill).
 */
const MIGRATIONS = [
  '001_schema.sql',
  '002_rls.sql',
  '003_seed_demo.sql',
  '004_chainage.sql',
  '005_auth_dpr_gps.sql',
];

export function testDbUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL is not set (e.g. postgres://kwa@localhost:5432/kwa_test)',
    );
  }
  return url;
}

export async function resetSchema(): Promise<void> {
  const client = new Client({ connectionString: testDbUrl() });
  await client.connect();
  try {
    await client.query('DROP SCHEMA IF EXISTS kwa CASCADE');
    const dir = join(__dirname, '..', '..', 'migrations');
    for (const file of MIGRATIONS) {
      const sql = readFileSync(join(dir, file), 'utf8');
      await client.query(sql);
    }
  } finally {
    await client.end();
  }
}

/** A DatabaseService pointed at the test DB. */
export function makeDb(): DatabaseService {
  process.env.DATABASE_URL = testDbUrl();
  const db = new DatabaseService(new ConfigService());
  db.onModuleInit();
  return db;
}

/** Seed identifiers from migration 003. */
export const SEED = {
  divisionTvmSouth: '11111111-0000-0000-0000-000000000003',
  ee: '22222222-0000-0000-0000-000000000001', // div scope
  eePhone: '9000000001',
  aee: '22222222-0000-0000-0000-000000000002',
  ae: '22222222-0000-0000-0000-000000000003',
  overseer: '22222222-0000-0000-0000-000000000004',
  projectA: '55555555-0000-0000-0000-000000000001',
  milestoneA: '55555555-1111-0000-0000-000000000001',
  lockedMbA: '55555555-2222-0000-0000-000000000001',
  billA: '55555555-3333-0000-0000-000000000001',
  sorItemDi300: '33333333-1111-0000-0000-000000000001', // base 1200
} as const;

/** Identifiers for a SECOND division created in tests (out of EE's scope). */
export const OTHER = {
  divisionB: '99999999-0000-0000-0000-0000000000b0',
  userB: '99999999-0000-0000-0000-0000000000b1',
  projectB: '99999999-0000-0000-0000-0000000000b2',
} as const;

/**
 * Create a second division + a user scoped only to it + a project in it.
 * org_unit/app_user/user_scope are not RLS-protected, so they insert via a raw
 * connection; the project must be inserted within userB's context to satisfy
 * the WITH CHECK policy.
 */
export async function seedSecondDivision(db: DatabaseService): Promise<void> {
  await db.raw(async (c) => {
    await c.query(
      `INSERT INTO kwa.org_unit (id, name, level, parent_id, code)
       VALUES ($1,'TVM North Division','division',
               '11111111-0000-0000-0000-000000000002','D-TVMN')`,
      [OTHER.divisionB],
    );
    await c.query(
      `INSERT INTO kwa.app_user (id, name, phone, role, home_unit_id)
       VALUES ($1,'EE North','9000000099','ee',$2)`,
      [OTHER.userB, OTHER.divisionB],
    );
    await c.query(
      `INSERT INTO kwa.user_scope (user_id, org_unit_id) VALUES ($1,$2)`,
      [OTHER.userB, OTHER.divisionB],
    );
  });
  // project insert is RLS-checked → must run as userB
  await db.withUser(OTHER.userB, async (c) => {
    await c.query(
      `INSERT INTO kwa.project (id, name, org_unit_id, status)
       VALUES ($1,'North Reach-1',$2,'in_progress')`,
      [OTHER.projectB, OTHER.divisionB],
    );
  });
}
