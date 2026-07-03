import {
  Controller,
  Get,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

/**
 * Liveness and readiness probes (public, unauthenticated). Point a load
 * balancer / k8s `livenessProbe` at /health and `readinessProbe` at
 * /health/ready — the latter fails (503) when the database is unreachable, so
 * traffic is held back until the dependency is actually up.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  live(): { status: string } {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready(): Promise<{ status: string; db: string }> {
    try {
      await this.db.raw((c) => c.query('SELECT 1'));
      return { status: 'ready', db: 'up' };
    } catch {
      throw new ServiceUnavailableException({ status: 'not-ready', db: 'down' });
    }
  }
}
