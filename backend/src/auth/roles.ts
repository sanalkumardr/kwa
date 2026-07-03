import { ForbiddenException } from '@nestjs/common';
import { PoolClient } from 'pg';

/**
 * KWA/PWD role hierarchy as ranks. Higher rank ⊇ lower rank's authority.
 * This is the server-side authority for "who may do what" — the client only
 * hides buttons; the database is where the rule actually binds.
 */
export const ROLE_RANK = {
  contractor: 1,
  overseer: 2,
  ae: 3,
  aee: 4,
  ee: 5,
  admin: 6,
} as const;

export type Role = keyof typeof ROLE_RANK;

/**
 * Throw ForbiddenException unless the acting user's role is at least `min`.
 * Runs inside the request transaction (app_user is not RLS-scoped), so the
 * check is atomic with the action it guards.
 */
export async function requireMinRole(
  c: PoolClient,
  userId: string,
  min: Role,
): Promise<void> {
  const r = await c.query<{ role: string }>(
    'SELECT role FROM kwa.app_user WHERE id = $1 AND deleted = false',
    [userId],
  );
  const role = r.rows[0]?.role;
  const rank = role ? ROLE_RANK[role as Role] : undefined;
  if (rank === undefined || rank < ROLE_RANK[min]) {
    throw new ForbiddenException(`Action requires ${min} role or higher`);
  }
}
