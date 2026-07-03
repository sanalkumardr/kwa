import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { requireMinRole } from '../auth/roles';

export interface BillSummary {
  id: string;
  running_bill_no: number;
  gross_amount: string;
  total_deductions: string;
  net_payable: string;
  status: string;
}

export interface BillDeductionRow {
  type_code: string;
  basis_amount: string;
  rate_pct: string;
  amount: string;
}

@Injectable()
export class BillsService {
  constructor(private readonly db: DatabaseService) {}

  /** List a project's bills (newest first). RLS scopes to the caller. */
  async listByProject(userId: string, projectId: string): Promise<BillSummary[]> {
    return this.db.withUser(userId, async (c) => {
      const { rows } = await c.query<BillSummary>(
        `SELECT id, running_bill_no, gross_amount, total_deductions,
                net_payable, status
         FROM kwa.bill
         WHERE project_id = $1 AND deleted = false
         ORDER BY running_bill_no DESC`,
        [projectId],
      );
      return rows;
    });
  }

  /** Create a draft bill for a project. RLS guarantees the user owns the project. */
  async createDraft(
    userId: string,
    projectId: string,
    referenceDate: string,
  ): Promise<BillSummary> {
    return this.db.withUser(userId, async (c) => {
      await requireMinRole(c, userId, 'ae'); // bill prep: AE and up
      const { rows } = await c.query<BillSummary>(
        `INSERT INTO kwa.bill (project_id, running_bill_no, reference_date)
         VALUES ($1,
                 COALESCE((SELECT MAX(running_bill_no) FROM kwa.bill WHERE project_id = $1), 0) + 1,
                 $2)
         RETURNING id, running_bill_no, gross_amount, total_deductions, net_payable, status`,
        [projectId, referenceDate],
      );
      return rows[0];
    });
  }

  /**
   * Pull approved MB entries into the bill and apply deduction rules,
   * delegating to the database function kwa.compute_bill (single source of truth).
   */
  async compute(userId: string, billId: string): Promise<BillSummary> {
    return this.db.withUser(userId, async (c) => {
      await requireMinRole(c, userId, 'ae'); // bill prep: AE and up
      await c.query('SELECT kwa.compute_bill($1)', [billId]);
      const { rows } = await c.query<BillSummary>(
        `SELECT id, running_bill_no, gross_amount, total_deductions, net_payable, status
         FROM kwa.bill WHERE id = $1`,
        [billId],
      );
      if (rows.length === 0) throw new NotFoundException('Bill not found');
      return rows[0];
    });
  }

  /** Certify a bill. The DB trigger stamps certified_at and locks it immutably. */
  async certify(userId: string, billId: string): Promise<BillSummary> {
    return this.db.withUser(userId, async (c) => {
      await requireMinRole(c, userId, 'aee'); // certification: AEE and up

      // Don't certify an empty bill — gross must be > 0 (i.e. compute has run
      // and pulled at least one approved MB entry).
      const pre = await c.query<{ gross_amount: string; status: string }>(
        `SELECT gross_amount, status FROM kwa.bill
          WHERE id = $1 AND deleted = false`,
        [billId],
      );
      if (pre.rows.length === 0) throw new NotFoundException('Bill not found');
      if (Number(pre.rows[0].gross_amount) <= 0) {
        throw new BadRequestException(
          'Bill has nothing to certify — run compute first',
        );
      }

      const { rows } = await c.query<BillSummary>(
        `UPDATE kwa.bill
            SET certified_by = $2
          WHERE id = $1 AND deleted = false
        RETURNING id, running_bill_no, gross_amount, total_deductions, net_payable, status`,
        [billId, userId],
      );
      if (rows.length === 0) throw new NotFoundException('Bill not found');
      return rows[0];
    });
  }

  async deductions(userId: string, billId: string): Promise<BillDeductionRow[]> {
    return this.db.withUser(userId, async (c) => {
      const { rows } = await c.query<BillDeductionRow>(
        `SELECT type_code, basis_amount, rate_pct, amount
         FROM kwa.bill_deduction
         WHERE bill_id = $1 AND deleted = false
         ORDER BY amount DESC`,
        [billId],
      );
      return rows;
    });
  }
}
