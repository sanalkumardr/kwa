import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

export interface IssueRow {
  id: string;
  project_id: string;
  title: string;
  priority: string | null;
  assignee_id: string | null;
  due_date: string | null;
  status: string;
  lat: number | null;
  lng: number | null;
}

export interface CreateIssueDto {
  projectId: string;
  title: string;
  priority?: 'low' | 'med' | 'high';
  assigneeId?: string;
  dueDate?: string;
  /** GPS pin [lng, lat] */
  location?: [number, number];
  photos?: string[];
}

const ISSUE_SELECT = `id, project_id, title, priority, assignee_id, due_date,
  status, ST_Y(location) AS lat, ST_X(location) AS lng`;

@Injectable()
export class IssuesService {
  constructor(private readonly db: DatabaseService) {}

  /** Raise a GPS-pinned site issue/snag. Any authenticated field user may. */
  async create(userId: string, dto: CreateIssueDto): Promise<IssueRow> {
    return this.db.withUser(userId, async (c) => {
      const { rows } = await c.query<IssueRow>(
        `INSERT INTO kwa.issue
           (project_id, title, priority, assignee_id, due_date, status,
            location, photos, created_by)
         VALUES ($1,$2,$3,$4,$5,'open',
                 CASE WHEN $6::float8 IS NULL THEN NULL
                      ELSE ST_SetSRID(ST_MakePoint($6,$7),4326) END,
                 $8,$9)
         RETURNING ${ISSUE_SELECT}`,
        [
          dto.projectId,
          dto.title,
          dto.priority ?? null,
          dto.assigneeId ?? null,
          dto.dueDate ?? null,
          dto.location ? dto.location[0] : null,
          dto.location ? dto.location[1] : null,
          JSON.stringify(dto.photos ?? []),
          userId,
        ],
      );
      return rows[0];
    });
  }

  async listByProject(
    userId: string,
    projectId: string,
    status?: string,
  ): Promise<IssueRow[]> {
    return this.db.withUser(userId, async (c) => {
      const { rows } = await c.query<IssueRow>(
        `SELECT ${ISSUE_SELECT}
         FROM kwa.issue
         WHERE project_id = $1 AND deleted = false
           AND ($2::text IS NULL OR status = $2)
         ORDER BY
           CASE priority WHEN 'high' THEN 0 WHEN 'med' THEN 1 ELSE 2 END,
           due_date NULLS LAST`,
        [projectId, status ?? null],
      );
      return rows;
    });
  }

  /** Move an issue through open → in_progress → resolved. */
  async setStatus(
    userId: string,
    id: string,
    status: 'open' | 'in_progress' | 'resolved',
  ): Promise<IssueRow> {
    return this.db.withUser(userId, async (c) => {
      const { rows } = await c.query<IssueRow>(
        `UPDATE kwa.issue SET status = $2
          WHERE id = $1 AND deleted = false
        RETURNING ${ISSUE_SELECT}`,
        [id, status],
      );
      if (rows.length === 0) throw new NotFoundException('Issue not found');
      return rows[0];
    });
  }
}
