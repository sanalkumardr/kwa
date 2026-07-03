import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, PoolClient } from 'pg';

/**
 * DatabaseService owns the pg connection pool and exposes the ONE pattern that
 * makes the RLS-first schema safe: `withUser`.
 *
 * Every request must run its queries inside a transaction that has executed
 *     SELECT set_config('kwa.current_user_id', <uuid>, true)
 * so that:
 *   - row-level security scopes visible projects to the user's org subtree, and
 *   - audit triggers record the correct actor.
 *
 * `set_config(..., true)` is transaction-local, so the setting is automatically
 * cleared when the transaction ends — no leakage across pooled connections.
 */
@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private pool!: Pool;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    this.pool = new Pool({
      connectionString: this.config.getOrThrow<string>('DATABASE_URL'),
      max: 10,
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool?.end();
  }

  /**
   * Run `fn` inside a transaction bound to `userId`. Commits on success,
   * rolls back on any throw. Use this for ALL request-scoped data access.
   */
  async withUser<T>(
    userId: string,
    fn: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // transaction-local; auto-reset at COMMIT/ROLLBACK
      await client.query('SELECT set_config($1, $2, true)', [
        'kwa.current_user_id',
        userId,
      ]);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /** Admin/maintenance escape hatch with NO user context (bypasses request RLS). */
  async raw<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      return await fn(client);
    } finally {
      client.release();
    }
  }
}
