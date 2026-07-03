-- =====================================================================
-- 004_chainage.sql — PostGIS chainage math (Phase 1 GIS layer)
-- Run after 003. Structural; safe for all environments.
--
-- A pipeline is a LINE, not a building: progress is measured along the route by
-- chainage (km 0+000 → end), not per floor. These functions turn the stored
-- geometry into the numbers the app actually needs:
--   * map a GPS point to a chainage along the route
--   * planned km (from segment geometry) vs actual laid km (from approved MB)
--
-- All functions are SQL + STABLE and run SECURITY INVOKER, so RLS on
-- pipeline_segment / mb_entry still scopes results to the caller.
-- =====================================================================

BEGIN;
SET search_path = kwa, public;

-- Chainage (km) of a point projected onto a specific segment.
-- ST_LineLocatePoint is 2D-only, so we Force2D the stored (3D) geometry.
CREATE OR REPLACE FUNCTION kwa.segment_chainage_of_point(
  p_segment uuid,
  p_point   geometry
) RETURNS numeric
LANGUAGE sql STABLE AS $$
  SELECT round((
           s.chainage_from
           + ST_LineLocatePoint(ST_Force2D(s.geom), ST_SetSRID(p_point, 4326))
             * (s.chainage_to - s.chainage_from)
         )::numeric, 3)
  FROM kwa.pipeline_segment s
  WHERE s.id = p_segment AND s.deleted = false AND s.geom IS NOT NULL;
$$;

-- Nearest segment to a lon/lat for a project, plus the chainage there and the
-- perpendicular distance from the route (metres) — useful to flag a photo or
-- measurement taken well off the alignment.
CREATE OR REPLACE FUNCTION kwa.locate_chainage(
  p_project uuid,
  p_lng     double precision,
  p_lat     double precision
) RETURNS TABLE(segment_id uuid, chainage numeric, distance_m double precision)
LANGUAGE sql STABLE AS $$
  WITH pt AS (SELECT ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326) AS g)
  SELECT s.id,
         round((
           s.chainage_from
           + ST_LineLocatePoint(ST_Force2D(s.geom), pt.g)
             * (s.chainage_to - s.chainage_from)
         )::numeric, 3),
         ST_Distance(ST_Force2D(s.geom)::geography, pt.g::geography)
  FROM kwa.pipeline_segment s, pt
  WHERE s.project_id = p_project AND s.deleted = false AND s.geom IS NOT NULL
  ORDER BY s.geom <-> pt.g     -- KNN: nearest segment first
  LIMIT 1;
$$;

-- Planned route length (km) = sum of segment chainage spans.
CREATE OR REPLACE FUNCTION kwa.project_planned_km(p_project uuid)
RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT COALESCE(round(SUM(chainage_to - chainage_from)::numeric, 3), 0)
  FROM kwa.pipeline_segment
  WHERE project_id = p_project AND deleted = false;
$$;

-- Actual laid length (km) = sum of approved (locked) MB chainage ranges.
-- Only measurement entries that survived the AE→AEE approval count, so the
-- physical progress figure is audit-aligned with the bill chain.
CREATE OR REPLACE FUNCTION kwa.project_laid_km(p_project uuid)
RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT COALESCE(round(SUM(GREATEST(chainage_to - chainage_from, 0))::numeric, 3), 0)
  FROM kwa.mb_entry
  WHERE project_id = p_project AND deleted = false AND locked_flag = true
    AND chainage_from IS NOT NULL AND chainage_to IS NOT NULL;
$$;

COMMIT;
