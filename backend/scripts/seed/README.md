# Seed loaders — hydrate baseline operational reality

Three small, dependency-light loaders that put real data behind the financial and
spatial logic. They connect via `DATABASE_URL` and run inside a per-user
transaction so RLS and the audit log apply.

| Script | Loads | Into |
|---|---|---|
| `load-sor.js` | Schedule of Rates (CSV or JSON) | `sor_edition` + `sor_item` |
| `load-routes.js` | Pipeline route (KML or GeoJSON `LineString`s) | `pipeline_segment` (chainage from geodesic length) |
| `seed.js` | Both, from a manifest, + binds projects to the edition | the above + `project_sor_binding` |

## Prerequisites

The schema and the org units / users / projects must already exist (migrations,
plus migration 003's demo data or your own bootstrap). The `user` you pass must
be an `app_user` **scoped to the projects being seeded** — RLS applies to
`pipeline_segment` and the SOR binding.

## One-shot seed

```bash
cd backend
DATABASE_URL=postgres://kwa_app:****@host:5432/kwa \
  node scripts/seed/seed.js scripts/seed/samples/manifest.json
```

The manifest names the SOR edition + file, and a list of projects with their
tender premium and route file:

```json
{
  "user": "<app_user uuid>",
  "edition": { "code": "KWA-2025-26", "title": "...", "authority": "KWA",
               "from": "2025-04-01", "file": "sor.csv" },
  "projects": [
    { "id": "<project uuid>", "tenderPremiumPct": 4.5,
      "routeFile": "route.kml", "diameterMm": 300, "material": "DI", "startKm": 0 }
  ]
}
```

## Individual loaders

```bash
# SOR only
node scripts/seed/load-sor.js path/to/sor.csv \
  --code KWA-2025-26 --title "KWA SOR 2025-26" --authority KWA --from 2025-04-01 --user <uuid>

# Routes only
node scripts/seed/load-routes.js path/to/route.kml \
  --project <uuid> --user <uuid> --diameter 300 --material DI --start-km 0
```

## Formats

- **SOR CSV:** header `item_code,description,unit,base_rate,chapter`.
- **SOR JSON:** `[{ "itemCode","description","unit","baseRate","chapter" }]`.
- **Route KML:** one segment per `<LineString>`, named by its `<Placemark><name>`.
- **Route GeoJSON:** `FeatureCollection` / `Feature` / geometry with
  `LineString` or `MultiLineString`; feature `properties.name` becomes the
  segment name.

Chainage spans are computed from geodesic (haversine) length in km, so each
segment gets `chainage_from → chainage_to` without depending on PostGIS; the
geometry itself is stored via `ST_GeomFromGeoJSON`.

## Idempotency

Re-running is safe: SOR edition (by `code`) and items (by `edition_id,item_code`)
and the project binding (by `project_id`) are upserts. Route loading inserts
fresh segments — clear a project's `pipeline_segment` rows before re-loading a
changed route.

## Validation

These loaders were run end-to-end against a real PostgreSQL on the sample data
(`samples/`): 6 SOR items, a 2-segment 3.246 km route, binding at 4.5%, with the
GeoJSON geometry stored and chainage computed — all green.
