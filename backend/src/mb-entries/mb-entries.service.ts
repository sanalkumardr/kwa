import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service';
import { requireMinRole } from '../auth/roles';

export interface MbEntryRow {
  id: string;
  project_id: string;
  milestone_id: string;
  chainage_from: string | null;
  chainage_to: string | null;
  quantity: string;
  unit: string | null;
  rate_snapshot: string;
  amount: string;
  measured_by: string;
  checked_by: string | null;
  approved_by: string | null;
  locked_flag: boolean;
}

export interface CreateMbEntryDto {
  milestoneId: string;
  sorItemId?: string;
  extraItemId?: string;
  chainageFrom?: number;
  chainageTo?: number;
  quantity: number;
  unit?: string;
  /** [longitude, latitude] of the measurement location */
  gps?: [number, number];
  photos?: string[];
}

@Injectable()
export class MbEntriesService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Record a measurement. Exactly one of sorItemId / extraItemId must be given.
   * The effective rate is derived server-side and frozen onto the row as
   * rate_snapshot, so the amount can never drift if SOR or extra-item rates
   * change later:
   *   - SOR item:   base_rate * (1 + project tender_premium_pct/100)
   *   - extra item: the approved derived_rate
   */
  async create(userId: string, dto: CreateMbEntryDto): Promise<MbEntryRow> {
    if ((dto.sorItemId == null) === (dto.extraItemId == null)) {
      throw new BadRequestException(
        'Provide exactly one of sorItemId or extraItemId',
      );
    }
    if (!(dto.quantity > 0)) {
      throw new BadRequestException('Quantity must be positive');
    }

    return this.db.withUser(userId, async (c) => {
      await requireMinRole(c, userId, 'overseer'); // measuring staff and up
      // resolve project + a sanity check that the milestone is visible (RLS)
      const ms = await c.query<{ project_id: string }>(
        `SELECT project_id FROM kwa.milestone
          WHERE id = $1 AND deleted = false`,
        [dto.milestoneId],
      );
      if (ms.rows.length === 0) throw new NotFoundException('Milestone not found');
      const projectId = ms.rows[0].project_id;

      const rate = await this.deriveRate(c, projectId, dto);

      const { rows } = await c.query<MbEntryRow>(
        `INSERT INTO kwa.mb_entry
           (project_id, milestone_id, sor_item_id, extra_item_id,
            chainage_from, chainage_to, quantity, unit, rate_snapshot,
            gps, photos, measured_by, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,
                 CASE WHEN $10::float8 IS NULL THEN NULL
                      ELSE ST_SetSRID(ST_MakePoint($10,$11),4326) END,
                 $12,$13,$13)
         RETURNING id, project_id, milestone_id, chainage_from, chainage_to,
                   quantity, unit, rate_snapshot, amount,
                   measured_by, checked_by, approved_by, locked_flag`,
        [
          projectId,
          dto.milestoneId,
          dto.sorItemId ?? null,
          dto.extraItemId ?? null,
          dto.chainageFrom ?? null,
          dto.chainageTo ?? null,
          dto.quantity,
          dto.unit ?? null,
          rate,
          dto.gps ? dto.gps[0] : null,
          dto.gps ? dto.gps[1] : null,
          JSON.stringify(dto.photos ?? []),
          userId,
        ],
      );
      return rows[0];
    });
  }

  /** AE check. Allowed only before approval (the row is not yet locked). */
  async check(userId: string, id: string): Promise<MbEntryRow> {
    return this.update(
      userId,
      id,
      `UPDATE kwa.mb_entry SET checked_by = $2
        WHERE id = $1 AND deleted = false`,
      userId,
      'ae',
    );
  }

  /**
   * AEE approval. Setting approved_by trips the mb_lock_guard trigger, which
   * stamps approved_at and sets locked_flag = true — the row is immutable after
   * this. Requires an AE check first.
   */
  async approve(userId: string, id: string): Promise<MbEntryRow> {
    return this.db.withUser(userId, async (c) => {
      await requireMinRole(c, userId, 'aee'); // verifying officer and up
      const pre = await c.query<{ checked_by: string | null }>(
        `SELECT checked_by FROM kwa.mb_entry
          WHERE id = $1 AND deleted = false`,
        [id],
      );
      if (pre.rows.length === 0) throw new NotFoundException('MB entry not found');
      if (pre.rows[0].checked_by == null) {
        throw new ConflictException('MB entry must be checked by an AE first');
      }
      const { rows } = await c.query<MbEntryRow>(
        `UPDATE kwa.mb_entry SET approved_by = $2
          WHERE id = $1 AND deleted = false
        RETURNING id, project_id, milestone_id, chainage_from, chainage_to,
                  quantity, unit, rate_snapshot, amount,
                  measured_by, checked_by, approved_by, locked_flag`,
        [id, userId],
      );
      return rows[0];
    });
  }

  async listByMilestone(
    userId: string,
    milestoneId: string,
  ): Promise<MbEntryRow[]> {
    return this.db.withUser(userId, async (c) => {
      const { rows } = await c.query<MbEntryRow>(
        `SELECT id, project_id, milestone_id, chainage_from, chainage_to,
                quantity, unit, rate_snapshot, amount,
                measured_by, checked_by, approved_by, locked_flag
         FROM kwa.mb_entry
         WHERE milestone_id = $1 AND deleted = false
         ORDER BY chainage_from NULLS LAST, created_at`,
        [milestoneId],
      );
      return rows;
    });
  }

  // ---- helpers --------------------------------------------------------

  private async deriveRate(
    c: PoolClient,
    projectId: string,
    dto: CreateMbEntryDto,
  ): Promise<string> {
    if (dto.sorItemId) {
      const r = await c.query<{ rate: string }>(
        `SELECT round(si.base_rate * (1 + COALESCE(b.tender_premium_pct,0)/100.0), 2) AS rate
         FROM kwa.sor_item si
         JOIN kwa.project_sor_binding b ON b.project_id = $2
         WHERE si.id = $1 AND si.deleted = false`,
        [dto.sorItemId, projectId],
      );
      if (r.rows.length === 0) {
        throw new BadRequestException(
          'SOR item not found, or project has no SOR binding',
        );
      }
      return r.rows[0].rate;
    }
    // extra item: must be approved
    const r = await c.query<{ derived_rate: string | null }>(
      `SELECT derived_rate FROM kwa.extra_item
        WHERE id = $1 AND project_id = $2 AND status = 'approved' AND deleted = false`,
      [dto.extraItemId, projectId],
    );
    if (r.rows.length === 0 || r.rows[0].derived_rate == null) {
      throw new BadRequestException('Extra item not found or not approved');
    }
    return r.rows[0].derived_rate;
  }

  private async update(
    userId: string,
    id: string,
    sql: string,
    param2: string,
    minRole: 'overseer' | 'ae' | 'aee' | 'ee',
  ): Promise<MbEntryRow> {
    return this.db.withUser(userId, async (c) => {
      await requireMinRole(c, userId, minRole);
      const res = await c.query(sql, [id, param2]);
      if (res.rowCount === 0) throw new NotFoundException('MB entry not found');
      const { rows } = await c.query<MbEntryRow>(
        `SELECT id, project_id, milestone_id, chainage_from, chainage_to,
                quantity, unit, rate_snapshot, amount,
                measured_by, checked_by, approved_by, locked_flag
         FROM kwa.mb_entry WHERE id = $1`,
        [id],
      );
      return rows[0];
    });
  }
}
