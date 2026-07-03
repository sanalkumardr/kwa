import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

export interface RollupRow {
  projectId: string;
  name: string;
  orgUnitId: string;
  plannedKm: number;
  laidKm: number;
  physicalPercent: number;
  certifiedNet: number;
  paid: number;
  openIssues: number;
}

export interface AuditRow {
  entity_table: string;
  entity_id: string;
  action: string;
  actor_id: string | null;
  at: string;
}

@Injectable()
export class ReportsService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Division rollup: physical (chainage) and financial (certified/paid) progress
   * per project, plus open-issue count. RLS already limits `project` to the
   * caller's org subtree; an optional orgUnitId narrows further to that node's
   * subtree. This is the leadership "division rollup" view.
   */
  async rollup(userId: string, orgUnitId?: string): Promise<RollupRow[]> {
    return this.db.withUser(userId, async (c) => {
      const { rows } = await c.query<{
        id: string;
        name: string;
        org_unit_id: string;
        planned_km: string;
        laid_km: string;
        certified_net: string;
        paid: string;
        open_issues: string;
      }>(
        `SELECT p.id, p.name, p.org_unit_id,
                kwa.project_planned_km(p.id) AS planned_km,
                kwa.project_laid_km(p.id)    AS laid_km,
                COALESCE((SELECT SUM(net_payable) FROM kwa.bill b
                          WHERE b.project_id = p.id AND b.deleted = false
                            AND b.status IN ('certified','paid')), 0) AS certified_net,
                COALESCE((SELECT SUM(pay.amount) FROM kwa.payment pay
                          WHERE pay.project_id = p.id AND pay.deleted = false), 0) AS paid,
                (SELECT COUNT(*) FROM kwa.issue i
                  WHERE i.project_id = p.id AND i.status = 'open' AND i.deleted = false)
                  AS open_issues
         FROM kwa.project p
         WHERE p.deleted = false
           AND ($1::uuid IS NULL
                OR p.org_unit_id IN (SELECT id FROM kwa.org_subtree($1)))
         ORDER BY p.name`,
        [orgUnitId ?? null],
      );
      return rows.map((r) => {
        const plannedKm = Number(r.planned_km);
        const laidKm = Number(r.laid_km);
        return {
          projectId: r.id,
          name: r.name,
          orgUnitId: r.org_unit_id,
          plannedKm,
          laidKm,
          physicalPercent:
            plannedKm > 0 ? Math.round((laidKm / plannedKm) * 1000) / 10 : 0,
          certifiedNet: Number(r.certified_net),
          paid: Number(r.paid),
          openIssues: Number(r.open_issues),
        };
      });
    });
  }

  /**
   * AG/CAG audit export: the full who/what/when trail for every record that
   * belongs to a project (sanction → MB → bills → deductions → payments → …).
   * The id-gathering subqueries are RLS-scoped, so only an authorised user's
   * project can be exported.
   */
  async auditExport(userId: string, projectId: string): Promise<AuditRow[]> {
    return this.db.withUser(userId, async (c) => {
      const { rows } = await c.query<AuditRow>(
        `WITH ids AS (
           SELECT id FROM kwa.project   WHERE id = $1
           UNION SELECT id FROM kwa.milestone    WHERE project_id = $1
           UNION SELECT id FROM kwa.mb_entry      WHERE project_id = $1
           UNION SELECT id FROM kwa.bill          WHERE project_id = $1
           UNION SELECT bl.id FROM kwa.bill_line bl
                   JOIN kwa.bill b ON b.id = bl.bill_id WHERE b.project_id = $1
           UNION SELECT bd.id FROM kwa.bill_deduction bd
                   JOIN kwa.bill b ON b.id = bd.bill_id WHERE b.project_id = $1
           UNION SELECT id FROM kwa.payment       WHERE project_id = $1
           UNION SELECT id FROM kwa.dpr           WHERE project_id = $1
           UNION SELECT id FROM kwa.quality_test  WHERE project_id = $1
           UNION SELECT id FROM kwa.issue         WHERE project_id = $1
         )
         SELECT a.entity_table, a.entity_id, a.action, a.actor_id, a.at
         FROM kwa.audit_log a JOIN ids ON a.entity_id = ids.id
         ORDER BY a.at`,
        [projectId],
      );
      return rows;
    });
  }
}
