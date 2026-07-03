import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

export interface DprRow {
  id: string;
  project_id: string;
  report_date: string;
  length_laid_today_m: string | null;
  chainage_reached: string | null;
  status: string;
  approved_by: string | null;
}

export interface CreateDprDto {
  projectId: string;
  reportDate: string;
  weather?: string;
  manpower?: unknown;
  machinery?: unknown;
  lengthLaidTodayM?: number;
  chainageReached?: number;
  workDone?: string;
  workPlanned?: string;
  photos?: string[];
  blockers?: string;
}

@Injectable()
export class DprService {
  constructor(private readonly db: DatabaseService) {}

  async create(userId: string, dto: CreateDprDto): Promise<DprRow> {
    return this.db.withUser(userId, async (c) => {
      const { rows } = await c.query<DprRow>(
        `INSERT INTO kwa.dpr
           (project_id, report_date, weather, manpower, machinery,
            length_laid_today_m, chainage_reached, work_done, work_planned,
            photos, blockers, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING id, project_id, report_date, length_laid_today_m,
                   chainage_reached, status, approved_by`,
        [
          dto.projectId,
          dto.reportDate,
          dto.weather ?? null,
          dto.manpower ?? null,
          dto.machinery ?? null,
          dto.lengthLaidTodayM ?? null,
          dto.chainageReached ?? null,
          dto.workDone ?? null,
          dto.workPlanned ?? null,
          JSON.stringify(dto.photos ?? []),
          dto.blockers ?? null,
          userId,
        ],
      );
      return rows[0];
    });
  }

  /** Move draft -> submitted. */
  async submit(userId: string, id: string): Promise<DprRow> {
    return this.transition(userId, id, 'submitted', null);
  }

  /** AE approval: submitted -> approved, stamping approver. */
  async approve(userId: string, id: string): Promise<DprRow> {
    return this.transition(userId, id, 'approved', userId);
  }

  private async transition(
    userId: string,
    id: string,
    status: string,
    approver: string | null,
  ): Promise<DprRow> {
    return this.db.withUser(userId, async (c) => {
      const { rows } = await c.query<DprRow>(
        `UPDATE kwa.dpr
            SET status = $2,
                approved_by = COALESCE($3, approved_by)
          WHERE id = $1 AND deleted = false
        RETURNING id, project_id, report_date, length_laid_today_m,
                  chainage_reached, status, approved_by`,
        [id, status, approver],
      );
      if (rows.length === 0) throw new NotFoundException('DPR not found');
      return rows[0];
    });
  }

  async listByProject(userId: string, projectId: string): Promise<DprRow[]> {
    return this.db.withUser(userId, async (c) => {
      const { rows } = await c.query<DprRow>(
        `SELECT id, project_id, report_date, length_laid_today_m,
                chainage_reached, status, approved_by
         FROM kwa.dpr
         WHERE project_id = $1 AND deleted = false
         ORDER BY report_date DESC`,
        [projectId],
      );
      return rows;
    });
  }
}
