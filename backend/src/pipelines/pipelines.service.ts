import { BadRequestException, Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

export interface SegmentRow {
  id: string;
  project_id: string;
  name: string | null;
  chainage_from: string | null;
  chainage_to: string | null;
  diameter_mm: number | null;
  material: string | null;
  status: string;
  geojson: string | null;
}

/** A GeoJSON LineString geometry, e.g. { type:'LineString', coordinates:[[lng,lat],...] } */
export interface CreateSegmentDto {
  projectId: string;
  name?: string;
  geometry: { type: string; coordinates: number[][] };
  chainageFrom: number;
  chainageTo: number;
  diameterMm?: number;
  material?: string;
  depthM?: number;
  jointing?: string;
}

export interface LocateResult {
  segmentId: string;
  chainage: number;
  distanceM: number;
}

export interface ProgressResult {
  plannedKm: number;
  actualKm: number;
  physicalPercent: number;
}

@Injectable()
export class PipelinesService {
  constructor(private readonly db: DatabaseService) {}

  /** Store a route reach as real geometry (LineStringZ; Z forced to 0 if 2D). */
  async createSegment(userId: string, dto: CreateSegmentDto): Promise<SegmentRow> {
    if (dto.geometry?.type !== 'LineString') {
      throw new BadRequestException('geometry must be a GeoJSON LineString');
    }
    return this.db.withUser(userId, async (c) => {
      const { rows } = await c.query<SegmentRow>(
        `INSERT INTO kwa.pipeline_segment
           (project_id, name, geom, chainage_from, chainage_to,
            diameter_mm, material, depth_m, jointing, created_by)
         VALUES ($1,$2,
                 ST_Force3D(ST_SetSRID(ST_GeomFromGeoJSON($3),4326)),
                 $4,$5,$6,$7,$8,$9,$10)
         RETURNING id, project_id, name, chainage_from, chainage_to,
                   diameter_mm, material, status,
                   ST_AsGeoJSON(geom) AS geojson`,
        [
          dto.projectId,
          dto.name ?? null,
          JSON.stringify(dto.geometry),
          dto.chainageFrom,
          dto.chainageTo,
          dto.diameterMm ?? null,
          dto.material ?? null,
          dto.depthM ?? null,
          dto.jointing ?? null,
          userId,
        ],
      );
      return rows[0];
    });
  }

  async listSegments(userId: string, projectId: string): Promise<SegmentRow[]> {
    return this.db.withUser(userId, async (c) => {
      const { rows } = await c.query<SegmentRow>(
        `SELECT id, project_id, name, chainage_from, chainage_to,
                diameter_mm, material, status, ST_AsGeoJSON(geom) AS geojson
         FROM kwa.pipeline_segment
         WHERE project_id = $1 AND deleted = false
         ORDER BY chainage_from NULLS LAST`,
        [projectId],
      );
      return rows;
    });
  }

  /** Map a GPS fix to chainage along the nearest reach of the route. */
  async locate(
    userId: string,
    projectId: string,
    lng: number,
    lat: number,
  ): Promise<LocateResult | null> {
    return this.db.withUser(userId, async (c) => {
      const { rows } = await c.query<{
        segment_id: string;
        chainage: string;
        distance_m: number;
      }>(`SELECT * FROM kwa.locate_chainage($1,$2,$3)`, [projectId, lng, lat]);
      if (rows.length === 0) return null;
      return {
        segmentId: rows[0].segment_id,
        chainage: Number(rows[0].chainage),
        distanceM: Number(rows[0].distance_m),
      };
    });
  }

  /** Planned vs actual physical progress for the project. */
  async progress(userId: string, projectId: string): Promise<ProgressResult> {
    return this.db.withUser(userId, async (c) => {
      const { rows } = await c.query<{ planned: string; laid: string }>(
        `SELECT kwa.project_planned_km($1) AS planned,
                kwa.project_laid_km($1)    AS laid`,
        [projectId],
      );
      const plannedKm = Number(rows[0].planned);
      const actualKm = Number(rows[0].laid);
      const physicalPercent =
        plannedKm > 0 ? Math.round((actualKm / plannedKm) * 1000) / 10 : 0;
      return { plannedKm, actualKm, physicalPercent };
    });
  }
}
