import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

export interface TenderRow {
  id: string;
  project_id: string;
  tender_no: string | null;
  contractor_id: string | null;
  agreement_value: string | null;
  work_order_date: string | null;
  completion_due_date: string | null;
  defect_liability_until: string | null;
}

export interface CreateTenderDto {
  projectId: string;
  tenderNo?: string;
  contractorId?: string;
  agreementValue?: number;
  workOrderDate?: string;
  completionDueDate?: string;
  emd?: number;
  securityDeposit?: number;
  defectLiabilityUntil?: string;
}

@Injectable()
export class TendersService {
  constructor(private readonly db: DatabaseService) {}

  async create(userId: string, dto: CreateTenderDto): Promise<TenderRow> {
    return this.db.withUser(userId, async (c) => {
      const { rows } = await c.query<TenderRow>(
        `INSERT INTO kwa.tender
           (project_id, tender_no, contractor_id, agreement_value,
            work_order_date, completion_due_date, emd, security_deposit,
            defect_liability_until, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING id, project_id, tender_no, contractor_id, agreement_value,
                   work_order_date, completion_due_date, defect_liability_until`,
        [
          dto.projectId,
          dto.tenderNo ?? null,
          dto.contractorId ?? null,
          dto.agreementValue ?? null,
          dto.workOrderDate ?? null,
          dto.completionDueDate ?? null,
          dto.emd ?? null,
          dto.securityDeposit ?? null,
          dto.defectLiabilityUntil ?? null,
          userId,
        ],
      );
      return rows[0];
    });
  }

  async getByProject(userId: string, projectId: string): Promise<TenderRow> {
    return this.db.withUser(userId, async (c) => {
      const { rows } = await c.query<TenderRow>(
        `SELECT id, project_id, tender_no, contractor_id, agreement_value,
                work_order_date, completion_due_date, defect_liability_until
         FROM kwa.tender
         WHERE project_id = $1 AND deleted = false
         ORDER BY created_at DESC LIMIT 1`,
        [projectId],
      );
      if (rows.length === 0) throw new NotFoundException('Tender not found');
      return rows[0];
    });
  }
}
