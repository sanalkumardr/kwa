import {
  Inject,
  Injectable,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomInt } from 'node:crypto';
import * as jwt from 'jsonwebtoken';
import { DatabaseService } from '../database/database.service';
import { OTP_SENDER, OtpSender } from './otp-sender';

export interface RequestOtpResult {
  sent: true;
  /** Only present when OTP_DEV_ECHO=true — for local dev / tests, never prod. */
  devCode?: string;
}

export interface VerifyOtpResult {
  token: string;
  userId: string;
}

export interface Me {
  id: string;
  name: string;
  role: string;
  homeUnitId: string | null;
}

const OTP_TTL_MIN = 5;
const MAX_ATTEMPTS = 5;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    @Inject(OTP_SENDER) private readonly sender: OtpSender,
  ) {}

  /** The authenticated user's profile, for role-gating the client UI. */
  async me(userId: string): Promise<Me> {
    return this.db.raw(async (c) => {
      const r = await c.query<{
        id: string;
        name: string;
        role: string;
        home_unit_id: string | null;
      }>(
        `SELECT id, name, role, home_unit_id
         FROM kwa.app_user WHERE id = $1 AND deleted = false`,
        [userId],
      );
      if (r.rows.length === 0) {
        throw new UnauthorizedException('User not found');
      }
      const u = r.rows[0];
      return { id: u.id, name: u.name, role: u.role, homeUnitId: u.home_unit_id };
    });
  }

  private hash(phone: string, code: string): string {
    // pepper with the JWT secret so a leaked otp table isn't brute-forceable offline
    const pepper = this.config.get<string>('JWT_SECRET') ?? '';
    return createHash('sha256').update(`${phone}:${code}:${pepper}`).digest('hex');
  }

  /**
   * Issue an OTP for a phone. To avoid user enumeration we always report
   * success; a code is only generated/stored when the phone maps to a user.
   */
  async requestOtp(phone: string): Promise<RequestOtpResult> {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const known = await this.db.raw(async (c) => {
      const u = await c.query<{ id: string }>(
        'SELECT id FROM kwa.app_user WHERE phone = $1 AND deleted = false',
        [phone],
      );
      if (u.rows.length === 0) {
        this.logger.warn(`OTP requested for unknown phone ${phone} — ignored`);
        return false;
      }
      await c.query(
        `INSERT INTO kwa.otp (phone, code_hash, expires_at)
         VALUES ($1, $2, now() + ($3 || ' minutes')::interval)`,
        [phone, this.hash(phone, code), String(OTP_TTL_MIN)],
      );
      return true;
    });

    // Deliver outside the DB transaction; only for a real user.
    if (known) {
      await this.sender.send(phone, code);
    }

    const result: RequestOtpResult = { sent: true };
    if (this.config.get<string>('OTP_DEV_ECHO') === 'true') {
      result.devCode = code;
    }
    return result;
  }

  /** Verify a code and, on success, issue a JWT whose `sub` is the app_user id. */
  async verifyOtp(phone: string, code: string): Promise<VerifyOtpResult> {
    return this.db.raw(async (c) => {
      const r = await c.query<{ id: string; attempts: number }>(
        `SELECT id, attempts FROM kwa.otp
          WHERE phone = $1 AND consumed = false AND expires_at > now()
          ORDER BY created_at DESC LIMIT 1`,
        [phone],
      );
      if (r.rows.length === 0) {
        throw new UnauthorizedException('No valid code; request a new one');
      }
      const otp = r.rows[0];
      if (otp.attempts >= MAX_ATTEMPTS) {
        throw new UnauthorizedException('Too many attempts; request a new code');
      }

      const matches = await c.query(
        'SELECT 1 FROM kwa.otp WHERE id = $1 AND code_hash = $2',
        [otp.id, this.hash(phone, code)],
      );
      if (matches.rows.length === 0) {
        await c.query('UPDATE kwa.otp SET attempts = attempts + 1 WHERE id = $1', [
          otp.id,
        ]);
        throw new UnauthorizedException('Incorrect code');
      }

      await c.query('UPDATE kwa.otp SET consumed = true WHERE id = $1', [otp.id]);
      const user = await c.query<{ id: string }>(
        'SELECT id FROM kwa.app_user WHERE phone = $1 AND deleted = false',
        [phone],
      );
      const userId = user.rows[0].id;
      const token = jwt.sign(
        { sub: userId },
        this.config.getOrThrow<string>('JWT_SECRET'),
        { expiresIn: '12h' },
      );
      return { token, userId };
    });
  }
}
