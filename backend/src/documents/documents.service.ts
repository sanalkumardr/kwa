import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

export interface DocumentRow {
  id: string;
  project_id: string;
  kind: string | null;
  version: number;
  storage_key: string;
  expires_on: string | null;
}

export interface CreateDocumentDto {
  projectId: string;
  kind: 'drawing' | 'permit' | 'agreement' | 'mb_scan' | 'noc';
  storageKey: string; // returned by POST /uploads
  version?: number;
  expiresOn?: string; // permits/NOCs
}

@Injectable()
export class DocumentsService {
  constructor(private readonly db: DatabaseService) {}

  /** Register an already-uploaded file (drawing, permit, agreement, scan). */
  async create(userId: string, dto: CreateDocumentDto): Promise<DocumentRow> {
    return this.db.withUser(userId, async (c) => {
      const { rows } = await c.query<DocumentRow>(
        `INSERT INTO kwa.document
           (project_id, kind, version, storage_key, expires_on, created_by)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING id, project_id, kind, version, storage_key, expires_on`,
        [
          dto.projectId,
          dto.kind,
          dto.version ?? 1,
          dto.storageKey,
          dto.expiresOn ?? null,
          userId,
        ],
      );
      return rows[0];
    });
  }

  async listByProject(userId: string, projectId: string): Promise<DocumentRow[]> {
    return this.db.withUser(userId, async (c) => {
      const { rows } = await c.query<DocumentRow>(
        `SELECT id, project_id, kind, version, storage_key, expires_on
         FROM kwa.document
         WHERE project_id = $1 AND deleted = false
         ORDER BY kind, version DESC`,
        [projectId],
      );
      return rows;
    });
  }

  /**
   * Permits/NOCs expiring within `withinDays` (default 30) — drives renewal
   * alerts so road-cutting permits etc. don't lapse mid-execution.
   */
  async expiring(
    userId: string,
    projectId: string,
    withinDays = 30,
  ): Promise<DocumentRow[]> {
    return this.db.withUser(userId, async (c) => {
      const { rows } = await c.query<DocumentRow>(
        `SELECT id, project_id, kind, version, storage_key, expires_on
         FROM kwa.document
         WHERE project_id = $1 AND deleted = false
           AND expires_on IS NOT NULL
           AND expires_on <= (now()::date + ($2 || ' days')::interval)
         ORDER BY expires_on`,
        [projectId, String(withinDays)],
      );
      return rows;
    });
  }
}
