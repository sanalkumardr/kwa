// Hydrate a fresh instance with baseline operational reality: load the SOR
// edition + rates, bind each project to that edition at its tender premium, and
// load each project's route geometry. One command from a manifest.
//
//   DATABASE_URL=... node scripts/seed/seed.js scripts/seed/samples/manifest.json
//
// Assumes org units, users, and projects already exist (from migrations or a
// separate bootstrap). The manifest's `user` must be an app_user scoped to the
// projects being seeded (RLS applies to pipeline_segment and the binding).
const fs = require('fs');
const path = require('path');
const { connect, withUser } = require('./lib');
const { loadSor } = require('./load-sor');
const { loadRoutes } = require('./load-routes');

async function run(manifestPath) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const dir = path.dirname(path.resolve(manifestPath));
  const rel = (p) => path.resolve(dir, p);
  const user = manifest.user;
  const client = connect();
  await client.connect();
  try {
    const ed = manifest.edition;
    const { editionId, items } = await loadSor(client, {
      file: rel(ed.file), code: ed.code, title: ed.title,
      authority: ed.authority, from: ed.from, user,
    });
    console.log(`SOR edition ${ed.code}: ${items.length} items`);

    for (const proj of manifest.projects ?? []) {
      // bind the project to the edition at its tender premium (idempotent)
      await withUser(client, user, () => client.query(
        `INSERT INTO kwa.project_sor_binding (project_id, edition_id, tender_premium_pct, bound_at, created_by)
         VALUES ($1,$2,$3, now()::date, $4)
         ON CONFLICT (project_id) DO UPDATE SET
           edition_id = EXCLUDED.edition_id, tender_premium_pct = EXCLUDED.tender_premium_pct`,
        [proj.id, editionId, proj.tenderPremiumPct ?? 0, user]));

      if (proj.routeFile) {
        const r = await loadRoutes(client, {
          file: rel(proj.routeFile), project: proj.id, user,
          diameter: proj.diameterMm ?? null, material: proj.material ?? null,
          startKm: proj.startKm ?? 0,
        });
        console.log(`Project ${proj.id}: premium ${proj.tenderPremiumPct ?? 0}% · ${r.count} segment(s), ${r.totalKm} km`);
      }
    }
    console.log('Seed complete.');
  } finally { await client.end(); }
}

if (require.main === module) {
  const m = process.argv[2];
  if (!m) { console.error('usage: seed.js <manifest.json>'); process.exit(1); }
  run(m).catch((e) => { console.error('seed failed:', e.message); process.exit(1); });
}
module.exports = { run };
