import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { requireMinRole } from '../auth/roles';

export interface QualityTestRow {
  id: string;
  project_id: string;
  pipeline_segment_id: string | null;
  test_type: string | null;
  result: string | null;
  value: string | null;
  tested_at: string | null;
  qc_by: string | null;
}

export interface CreateQualityTestDto {
  projectId: string;
  pipelineSegmentId?: string;
  testType: 'hydro' | 'pressure' | 'compaction' | 'material';
  result?: 'pass' | 'fail';
  value?: string;
  testedAt?: string;
}

@Injectable()
export class QualityService {
  constructor(private readonly db: DatabaseService) {}

  /** Record a QC test/inspection result. Recorded by site staff (overseer+). */
  async create(userId: string, dto: CreateQualityTestDto): Promise<QualityTestRow> {
    return this.db.withUser(userId, async (c) => {
      await requireMinRole(c, userId, 'overseer');
      const { rows } = await c.query<QualityTestRow>(
        `INSERT INTO kwa.quality_test
           (project_id, pipeline_segment_id, test_type, result, value,
            tested_at, qc_by, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$7)
         RETURNING id, project_id, pipeline_segment_id, test_type, result,
                   value, tested_at, qc_by`,
        [
          dto.projectId,
          dto.pipelineSegmentId ?? null,
          dto.testType,
          dto.result ?? null,
          dto.value ?? null,
          dto.testedAt ?? null,
          userId,
        ],
      );
      return rows[0];
    });
  }

  async listByProject(userId: string, projectId: string): Promise<QualityTestRow[]> {
    return this.db.withUser(userId, async (c) => {
      const { rows } = await c.query<QualityTestRow>(
        `SELECT id, project_id, pipeline_segment_id, test_type, result,
                value, tested_at, qc_by
         FROM kwa.quality_test
         WHERE project_id = $1 AND deleted = false
         ORDER BY tested_at DESC NULLS LAST, created_at DESC`,
        [projectId],
      );
      return rows;
    });
  }
}
