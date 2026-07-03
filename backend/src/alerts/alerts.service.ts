import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DatabaseService } from '../database/database.service';
import {
  NOTIFICATION_SENDER,
  NotificationSender,
} from '../notifications/notification-sender';

interface AtRiskRow {
  milestone_name: string;
  project_name: string;
  planned_date: string;
  officer_phone: string;
}

@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    @Inject(NOTIFICATION_SENDER) private readonly notify: NotificationSender,
  ) {}

  /**
   * Find milestones that are not done and due within 7 days (or overdue), and
   * alert the officers (AE/AEE/EE) responsible for the project. Runs in the
   * acting user's RLS scope, so a division officer only triggers alerts for
   * their own division; the daily cron uses a system user with authority-wide
   * scope. Returns the number of notifications sent.
   */
  async runMilestoneChecks(actingUserId: string): Promise<number> {
    return this.db.withUser(actingUserId, async (c) => {
      const { rows } = await c.query<AtRiskRow>(
        `SELECT m.name AS milestone_name,
                p.name AS project_name,
                to_char(m.planned_date, 'YYYY-MM-DD') AS planned_date,
                u.phone AS officer_phone
         FROM kwa.milestone m
         JOIN kwa.project p ON p.id = m.project_id
         JOIN kwa.user_scope us
           ON p.org_unit_id IN (SELECT id FROM kwa.org_subtree(us.org_unit_id))
         JOIN kwa.app_user u ON u.id = us.user_id
         WHERE m.deleted = false
           AND m.status <> 'done'
           AND m.planned_date IS NOT NULL
           AND m.planned_date <= (now()::date + interval '7 days')
           AND u.deleted = false
           AND u.role IN ('ae','aee','ee')
         ORDER BY m.planned_date`,
      );

      let sent = 0;
      for (const r of rows) {
        const msg =
          `KWA alert: milestone "${r.milestone_name}" on ${r.project_name} ` +
          `is at risk (due ${r.planned_date}).`;
        await this.notify.send(r.officer_phone, msg);
        sent++;
      }
      if (sent > 0) this.logger.log(`Sent ${sent} milestone alert(s)`);
      return sent;
    });
  }

  /** Daily scan. Needs SYSTEM_USER_ID (an admin with authority-wide scope). */
  @Cron(CronExpression.EVERY_DAY_AT_6AM)
  async dailyMilestoneScan(): Promise<void> {
    const systemUser = this.config.get<string>('SYSTEM_USER_ID');
    if (!systemUser) {
      this.logger.warn('SYSTEM_USER_ID not set — skipping daily milestone scan');
      return;
    }
    try {
      await this.runMilestoneChecks(systemUser);
    } catch (e) {
      this.logger.error(`Daily milestone scan failed: ${String(e)}`);
    }
  }
}
