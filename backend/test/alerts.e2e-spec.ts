import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../src/database/database.service';
import { AlertsService } from '../src/alerts/alerts.service';
import { NotificationSender } from '../src/notifications/notification-sender';
import { makeDb, resetSchema, SEED } from './test-db';

/** Captures notifications instead of sending them. */
class FakeSender implements NotificationSender {
  sent: { phone: string; message: string }[] = [];
  async send(phone: string, message: string): Promise<void> {
    this.sent.push({ phone, message });
  }
}

describe('Milestone at-risk alerts', () => {
  let db: DatabaseService;
  let alerts: AlertsService;
  let sender: FakeSender;

  beforeAll(async () => {
    await resetSchema();
    db = makeDb();
    sender = new FakeSender();
    alerts = new AlertsService(db, new ConfigService(), sender);
  }, 60_000);

  afterAll(async () => {
    await db.onModuleDestroy();
  });

  it('alerts officers about the overdue seeded milestone', async () => {
    // Seed milestone A is due 2025-08-31 and not done → at risk now.
    const count = await alerts.runMilestoneChecks(SEED.ee);
    expect(count).toBeGreaterThan(0);
    expect(sender.sent.length).toBe(count);
    // officers are the division's AE/AEE/EE (seed phones 900000000{1,2,3})
    const phones = new Set(sender.sent.map((s) => s.phone));
    expect(phones.has(SEED.eePhone)).toBe(true);
    expect(sender.sent[0].message).toMatch(/at risk/i);
  });
});
