import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { requireMinRole } from '../auth/roles';

export interface PaymentRow {
  id: string;
  bill_id: string;
  amount: string;
  sanctioned_by: string | null;
  payment_date: string | null;
  reference: string | null;
}

export interface CreatePaymentDto {
  billId: string;
  amount: number;
  paymentDate: string;
  reference?: string;
}

@Injectable()
export class PaymentsService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Sanction a payment against a CERTIFIED bill (EE action). We re-derive
   * project_id from the bill so the denormalized scope column stays correct,
   * and refuse to pay a bill that has not been certified.
   */
  async sanction(userId: string, dto: CreatePaymentDto): Promise<PaymentRow> {
    if (!(dto.amount > 0)) {
      throw new BadRequestException('Payment amount must be positive');
    }
    return this.db.withUser(userId, async (c) => {
      await requireMinRole(c, userId, 'ee'); // sanctioning payment: EE only
      const bill = await c.query<{
        project_id: string;
        status: string;
        net_payable: string;
      }>(
        `SELECT project_id, status, net_payable FROM kwa.bill
          WHERE id = $1 AND deleted = false`,
        [dto.billId],
      );
      if (bill.rows.length === 0) throw new NotFoundException('Bill not found');
      if (bill.rows[0].status === 'draft') {
        throw new BadRequestException('Bill must be certified before payment');
      }

      // Never pay out more than the bill's net payable (across all payments).
      const paid = await c.query<{ total: string }>(
        `SELECT COALESCE(SUM(amount), 0) AS total FROM kwa.payment
          WHERE bill_id = $1 AND deleted = false`,
        [dto.billId],
      );
      const net = Number(bill.rows[0].net_payable);
      const alreadyPaid = Number(paid.rows[0].total);
      if (alreadyPaid + dto.amount > net + 1e-6) {
        throw new BadRequestException(
          `Payment exceeds net payable (net ${net}, already paid ${alreadyPaid})`,
        );
      }

      const { rows } = await c.query<PaymentRow>(
        `INSERT INTO kwa.payment
           (bill_id, project_id, amount, sanctioned_by, payment_date, reference, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$4)
         RETURNING id, bill_id, amount, sanctioned_by, payment_date, reference`,
        [
          dto.billId,
          bill.rows[0].project_id,
          dto.amount,
          userId,
          dto.paymentDate,
          dto.reference ?? null,
        ],
      );

      // mark the bill paid (bill is locked; status flip is allowed by the guard
      // only because locked_flag blocks edits but the trigger permits this path
      // when transitioning certified -> paid via a dedicated update).
      await c.query(
        `UPDATE kwa.bill SET status = 'paid'
          WHERE id = $1 AND status = 'certified'`,
        [dto.billId],
      );
      return rows[0];
    });
  }

  async listByBill(userId: string, billId: string): Promise<PaymentRow[]> {
    return this.db.withUser(userId, async (c) => {
      const { rows } = await c.query<PaymentRow>(
        `SELECT id, bill_id, amount, sanctioned_by, payment_date, reference
         FROM kwa.payment
         WHERE bill_id = $1 AND deleted = false
         ORDER BY payment_date`,
        [billId],
      );
      return rows;
    });
  }
}
