import { Logger } from '@nestjs/common';

/** Delivers an OTP code to a phone. Swappable per environment. */
export interface OtpSender {
  send(phone: string, code: string): Promise<void>;
}

export const OTP_SENDER = 'OTP_SENDER';

/** Dev/default: logs the code instead of sending. Never use in production. */
export class LogOtpSender implements OtpSender {
  private readonly logger = new Logger('LogOtpSender');
  async send(phone: string, code: string): Promise<void> {
    this.logger.log(`OTP for ${phone}: ${code} (log sender — not delivered)`);
  }
}

/**
 * Generic HTTP SMS/WhatsApp gateway. POSTs `{ to, message }` (most Indian SMS
 * gateways accept this shape or a query-param variant) with an optional bearer
 * key. Configure via SMS_GATEWAY_URL / SMS_GATEWAY_API_KEY / SMS_MESSAGE_TEMPLATE.
 */
export class HttpOtpSender implements OtpSender {
  private readonly logger = new Logger('HttpOtpSender');
  constructor(
    private readonly url: string,
    private readonly apiKey?: string,
    private readonly template = 'Your KWA Pipeline Works code is {code}. Valid 5 minutes.',
  ) {}

  async send(phone: string, code: string): Promise<void> {
    const message = this.template
      .replace('{code}', code)
      .replace('{phone}', phone);
    const res = await fetch(this.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({ to: phone, message }),
    });
    if (!res.ok) {
      this.logger.error(`SMS gateway responded ${res.status}`);
      throw new Error(`SMS gateway error ${res.status}`);
    }
  }
}
