import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

/** Wire shape exchanged with the mobile client (camelCase, no local-only flags). */
export interface DprSyncJson {
  id: string;
  projectId: string;
  reportDate: string;
  weather: string | null;
  lengthLaidTodayM: number | null;
  chainageReached: number | null;
  workDone: string | null;
  workPlanned: string | null;
  blockers: string | null;
  status: string;
  updatedAt: string;
  deleted: boolean;
  // location (optional): device sends lat/lng; server derives chainage
  lat?: number | null;
  lng?: number | null;
  chainage?: number | null;
  segmentId?: string | null;
}

interface DprRow {
  id: string;
  project_id: string;
  report_date: string;
  weather: string | null;
  length_laid_today_m: string | null;
  chainage_reached: string | null;
  work_done: string | null;
  work_planned: string | null;
  blockers: string | null;
  status: string;
  updated_at: Date;
  deleted: boolean;
  lat: number | null;
  lng: number | null;
  chainage: string | null;
  segment_id: string | null;
}

function toJson(r: DprRow): DprSyncJson {
  return {
    id: r.id,
    projectId: r.project_id,
    reportDate:
      typeof r.report_date === 'string'
        ? r.report_date
        : new Date(r.report_date).toISOString().slice(0, 10),
    weather: r.weather,
    lengthLaidTodayM:
      r.length_laid_today_m == null ? null : Number(r.length_laid_today_m),
    chainageReached:
      r.chainage_reached == null ? null : Number(r.chainage_reached),
    workDone: r.work_done,
    workPlanned: r.work_planned,
    blockers: r.blockers,
    status: r.status,
    updatedAt: r.updated_at.toISOString(),
    deleted: r.deleted,
    lat: r.lat,
    lng: r.lng,
    chainage: r.chainage == null ? null : Number(r.chainage),
    segmentId: r.segment_id,
  };
}

const DPR_SELECT = `id, project_id, report_date, weather, length_laid_today_m,
  chainage_reached, work_done, work_planned, blockers, status,
  updated_at, deleted,
  ST_Y(gps) AS lat, ST_X(gps) AS lng, chainage, segment_id`;

@Injectable()
export class SyncService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Upsert a DPR by id. The database is authoritative for `updated_at` (the
   * touch trigger stamps now() on update; default now() on insert), so server
   * arrival order decides the winner — last-write-wins for this operational
   * entity. RLS guarantees the caller may write only within their org scope.
   *
   * The echoed row carries the server's `updatedAt`, which the client stores so
   * its watermark stays aligned with server time (no cross-device clock skew).
   */
  async upsertDpr(userId: string, j: DprSyncJson): Promise<DprSyncJson> {
    return this.db.withUser(userId, async (c) => {
      // If the device sent a GPS fix, derive chainage server-side by projecting
      // it onto the nearest route segment (RLS-scoped). Stored alongside the raw
      // point so the report is auto-tagged to its position along the pipeline.
      let chainage: number | null = null;
      let segmentId: string | null = null;
      if (j.lng != null && j.lat != null) {
        const loc = await c.query<{ segment_id: string; chainage: string }>(
          'SELECT segment_id, chainage FROM kwa.locate_chainage($1,$2,$3)',
          [j.projectId, j.lng, j.lat],
        );
        if (loc.rows.length > 0) {
          segmentId = loc.rows[0].segment_id;
          chainage = Number(loc.rows[0].chainage);
        }
      }

      // One DPR per (project, report_date): if that day already has a report
      // under a different id (another device's offline entry, or seed data),
      // merge into it — last-write-wins, same policy as the id conflict below.
      // The echoed row carries the winning id for the client to adopt.
      const existing = await c.query<{ id: string }>(
        'SELECT id FROM kwa.dpr WHERE project_id = $1 AND report_date = $2',
        [j.projectId, j.reportDate],
      );
      const targetId = existing.rows[0]?.id ?? j.id;

      const { rows } = await c.query<DprRow>(
        `INSERT INTO kwa.dpr
           (id, project_id, report_date, weather, length_laid_today_m,
            chainage_reached, work_done, work_planned, blockers, status,
            deleted, gps, chainage, segment_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
                 CASE WHEN $12::float8 IS NULL THEN NULL
                      ELSE ST_SetSRID(ST_MakePoint($12,$13),4326) END,
                 $14,$15,$16)
         ON CONFLICT (id) DO UPDATE SET
           weather             = EXCLUDED.weather,
           length_laid_today_m = EXCLUDED.length_laid_today_m,
           chainage_reached    = EXCLUDED.chainage_reached,
           work_done           = EXCLUDED.work_done,
           work_planned        = EXCLUDED.work_planned,
           blockers            = EXCLUDED.blockers,
           status              = EXCLUDED.status,
           deleted             = EXCLUDED.deleted,
           gps                 = EXCLUDED.gps,
           chainage            = EXCLUDED.chainage,
           segment_id          = EXCLUDED.segment_id
         RETURNING ${DPR_SELECT}`,
        [
          targetId,
          j.projectId,
          j.reportDate,
          j.weather ?? null,
          j.lengthLaidTodayM ?? null,
          j.chainageReached ?? null,
          j.workDone ?? null,
          j.workPlanned ?? null,
          j.blockers ?? null,
          j.status ?? 'draft',
          j.deleted ?? false,
          j.lng ?? null,
          j.lat ?? null,
          chainage,
          segmentId,
          userId,
        ],
      );
      return toJson(rows[0]);
    });
  }

  /**
   * Delta pull: every DPR changed since `since` (exclusive). Soft-deleted rows
   * are included so deletions propagate to other devices. RLS scopes the result
   * to the caller's org subtree. `since == null` is a full initial pull.
   */
  async pullDpr(userId: string, since: string | null): Promise<DprSyncJson[]> {
    return this.db.withUser(userId, async (c) => {
      const { rows } = await c.query<DprRow>(
        `SELECT ${DPR_SELECT}
         FROM kwa.dpr
         WHERE ($1::timestamptz IS NULL OR updated_at > $1)
         ORDER BY updated_at ASC`,
        [since],
      );
      return rows.map(toJson);
    });
  }
}
