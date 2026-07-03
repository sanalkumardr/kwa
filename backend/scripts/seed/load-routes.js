// Decode a pipeline route file (KML or GeoJSON), extract its LineString
// geometries, and load them as pipeline_segments so the PostGIS chainage math
// has a real physical path to project onto. Chainage spans are computed from
// geodesic length (km), so each segment gets chainage_from → chainage_to.
//
//   node scripts/seed/load-routes.js <file.kml|file.geojson> \
//        --project <uuid> --user <uuid> [--diameter 300 --material DI --start-km 0]
const { connect, withUser, lengthKm, parseRouteFile } = require('./lib');

/** Insert each LineString as a pipeline_segment. Returns { count, totalKm }. */
async function loadRoutes(client, { file, project, user, diameter, material, startKm = 0 }) {
  const segments = parseRouteFile(file);
  if (segments.length === 0) throw new Error(`no LineString geometries found in ${file}`);
  return withUser(client, user, async () => {
    let chainage = Number(startKm) || 0;
    let count = 0;
    for (const [i, seg] of segments.entries()) {
      const km = lengthKm(seg.coordinates);
      const from = Math.round(chainage * 1000) / 1000;
      const to = Math.round((chainage + km) * 1000) / 1000;
      const geojson = JSON.stringify({ type: 'LineString', coordinates: seg.coordinates });
      await client.query(
        `INSERT INTO kwa.pipeline_segment
           (project_id, name, geom, chainage_from, chainage_to, diameter_mm, material, status, created_by)
         VALUES ($1,$2,
                 ST_Force3D(ST_SetSRID(ST_GeomFromGeoJSON($3),4326)),
                 $4,$5,$6,$7,'planned',$8)`,
        [project, seg.name ?? `Reach ${i + 1}`, geojson, from, to, diameter ?? null, material ?? null, user],
      );
      chainage = to;
      count++;
    }
    return { count, totalKm: Math.round((chainage - (Number(startKm) || 0)) * 1000) / 1000 };
  });
}

async function main() {
  const [file] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const opt = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : d; };
  if (!file || !opt('project') || !opt('user')) {
    console.error('usage: load-routes.js <file> --project <uuid> --user <uuid> [--diameter --material --start-km]');
    process.exit(1);
  }
  const client = connect(); await client.connect();
  try {
    const r = await loadRoutes(client, {
      file, project: opt('project'), user: opt('user'),
      diameter: opt('diameter') ? Number(opt('diameter')) : null,
      material: opt('material'), startKm: Number(opt('start-km', '0')),
    });
    console.log(`Routes: ${r.count} segment(s), ${r.totalKm} km loaded`);
  } finally { await client.end(); }
}

if (require.main === module) main().catch((e) => { console.error('load-routes failed:', e.message); process.exit(1); });
module.exports = { loadRoutes };
