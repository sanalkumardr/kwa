import { Logger } from '@nestjs/common';

/** Sends a free-text notification (SMS/WhatsApp) to a phone. */
export interface NotificationSender {
  send(phone: string, message: string): Promise<void>;
}

export const NOTIFICATION_SENDER = 'NOTIFICATION_SENDER';

/** Dev/default: logs instead of delivering. */
export class LogNotificationSender implements NotificationSender {
  private readonly logger = new Logger('Notify');
  async send(phone: string, message: string): Promise<void> {
    this.logger.log(`→ ${phone}: ${message}`);
  }
}

/**
 * Generic HTTP SMS/WhatsApp gateway — POSTs `{ to, message }` with an optional
 * bearer key. Reuses the SMS_GATEWAY_* config so OTP and alerts share one
 * channel; point it at a WhatsApp Business API relay for WhatsApp delivery.
 */
export class HttpNotificationSender implements NotificationSender {
  private readonly logger = new Logger('Notify');
  constructor(
    private readonly url: string,
    private readonly apiKey?: string,
  ) {}

  async send(phone: string, message: string): Promise<void> {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({ to: phone, message }),
    });
    if (!res.ok) {
      this.logger.error(`gateway ${res.status} sending to ${phone}`);
      throw new Error(`notification gateway error ${res.status}`);
    }
  }
}
