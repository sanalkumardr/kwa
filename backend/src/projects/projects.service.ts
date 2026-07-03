import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

export interface ProjectRow {
  id: string;
  name: string;
  scheme: string | null;
  status: string;
  org_unit_id: string;
}

@Injectable()
export class ProjectsService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Lists projects. No WHERE clause on org scope is needed here — row-level
   * security filters to the user's org subtree automatically. This is the
   * whole point of the RLS-first design: scope can't be forgotten in app code.
   */
  async list(userId: string): Promise<ProjectRow[]> {
    return this.db.withUser(userId, async (c) => {
      const { rows } = await c.query<ProjectRow>(
        `SELECT id, name, scheme, status, org_unit_id
         FROM kwa.project
         WHERE deleted = false
         ORDER BY created_at DESC`,
      );
      return rows;
    });
  }
}
