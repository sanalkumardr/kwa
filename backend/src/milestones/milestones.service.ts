import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

export interface MilestoneRow {
  id: string;
  project_id: string;
  name: string;
  chainage_from: string | null;
  chainage_to: string | null;
  planned_qty: string | null;
  unit: string | null;
  planned_date: string | null;
  payment_percent: string | null;
  status: string;
}

export interface CreateMilestoneDto {
  projectId: string;
  name: string;
  chainageFrom?: number;
  chainageTo?: number;
  plannedQty?: number;
  unit?: string;
  plannedDate?: string;
  paymentPercent?: number;
  dependsOn?: string;
}

@Injectable()
export class MilestonesService {
  constructor(private readonly db: DatabaseService) {}

  async create(userId: string, dto: CreateMilestoneDto): Promise<MilestoneRow> {
    return this.db.withUser(userId, async (c) => {
      const { rows } = await c.query<MilestoneRow>(
        `INSERT INTO kwa.milestone
           (project_id, name, chainage_from, chainage_to, planned_qty, unit,
            planned_date, payment_percent, depends_on, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING id, project_id, name, chainage_from, chainage_to,
                   planned_qty, unit, planned_date, payment_percent, status`,
        [
          dto.projectId,
          dto.name,
          dto.chainageFrom ?? null,
          dto.chainageTo ?? null,
          dto.plannedQty ?? null,
          dto.unit ?? null,
          dto.plannedDate ?? null,
          dto.paymentPercent ?? null,
          dto.dependsOn ?? null,
          userId,
        ],
      );
      return rows[0];
    });
  }

  async listByProject(userId: string, projectId: string): Promise<MilestoneRow[]> {
    return this.db.withUser(userId, async (c) => {
      const { rows } = await c.query<MilestoneRow>(
        `SELECT id, project_id, name, chainage_from, chainage_to,
                planned_qty, unit, planned_date, payment_percent, status
         FROM kwa.milestone
         WHERE project_id = $1 AND deleted = false
         ORDER BY chainage_from NULLS LAST, planned_date`,
        [projectId],
      );
      return rows;
    });
  }

  async setStatus(
    userId: string,
    id: string,
    status: string,
  ): Promise<MilestoneRow> {
    return this.db.withUser(userId, async (c) => {
      const { rows } = await c.query<MilestoneRow>(
        `UPDATE kwa.milestone SET status = $2
          WHERE id = $1 AND deleted = false
        RETURNING id, project_id, name, chainage_from, chainage_to,
                  planned_qty, unit, planned_date, payment_percent, status`,
        [id, status],
      );
      if (rows.length === 0) throw new NotFoundException('Milestone not found');
      return rows[0];
    });
  }
}
