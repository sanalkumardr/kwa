// Chainage (PostGIS) validation WITHOUT a real PostGIS install. The risk in this
// code is not PostGIS itself but how kwa *composes* it — the
// `chainage_from + fraction × span` formula, GeoJSON decode, and planned/laid
// aggregation. So we shim the geometry type as a text domain and provide a
// FAITHFUL pure-SQL ST_LineLocatePoint that actually projects a point onto a
// polyline, then load the REAL migration-004 functions and the REAL compiled
// pipelines service and check the numbers.
//
// Usage: node test/validate-chainage.js   (server at PGHOST:PGPORT, default :5433)
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { ConfigService } = require('@nestjs/config');

const MIG = process.env.MIG_DIR || path.join(__dirname, '..', '..', 'migrations');
const HOST = process.env.PGHOST || '127.0.0.1';
const PORT = Number(process.env.PGPORT || 5433);
process.env.DATABASE_URL = `postgresql://kwa_app@${HOST}:${PORT}/kwa_test`;
const { DatabaseService } = require('../dist/database/database.service');
const { PipelinesService } = require('../dist/pipelines/pipelines.service');

const EE = '22222222-0000-0000-0000-000000000001';
const DIV = '11111111-0000-0000-0000-000000000003';
const P = '66666666-0000-0000-0000-0000000000c1';
const stub = (s) => s.split('\n').filter((l) => !/CREATE EXTENSION/.test(l)).join('\n')
  .replace(/geometry\([^)]*\)/g, 'geometry').replace(/ USING gist/g, '');
let pass = 0, fail = 0;
const ok = (n) => { console.log('  PASS', n); pass++; };
const no = (n, e) => { console.log('  FAIL', n, '—', e); fail++; };

// A faithful 2D ST_LineLocatePoint: fraction along a polyline of the closest point.
const LLP = `
CREATE FUNCTION public.st_linelocatepoint(line geometry, pt geometry) RETURNS float8
LANGUAGE plpgsql AS $$
DECLARE c jsonb := (line::jsonb)->'coordinates'; p jsonb := (pt::jsonb)->'coordinates';
  px float8:=(p->>0)::float8; py float8:=(p->>1)::float8; n int:=jsonb_array_length(c);
  i int; x1 float8; y1 float8; x2 float8; y2 float8; sl float8; t float8; cx float8; cy float8; d float8;
  acc float8:=0; total float8:=0; bestd float8; bestacc float8:=0;
BEGIN
  FOR i IN 0..n-2 LOOP
    x1:=(c->i->>0)::float8; y1:=(c->i->>1)::float8; x2:=(c->(i+1)->>0)::float8; y2:=(c->(i+1)->>1)::float8;
    total := total + sqrt((x2-x1)^2+(y2-y1)^2);
  END LOOP;
  IF total = 0 THEN RETURN 0; END IF;
  FOR i IN 0..n-2 LOOP
    x1:=(c->i->>0)::float8; y1:=(c->i->>1)::float8; x2:=(c->(i+1)->>0)::float8; y2:=(c->(i+1)->>1)::float8;
    sl := sqrt((x2-x1)^2+(y2-y1)^2);
    IF sl = 0 THEN CONTINUE; END IF;
    t := ((px-x1)*(x2-x1)+(py-y1)*(y2-y1))/(sl*sl); t := greatest(0, least(1, t));
    cx := x1+t*(x2-x1); cy := y1+t*(y2-y1); d := sqrt((px-cx)^2+(py-cy)^2);
    IF bestd IS NULL OR d < bestd THEN bestd := d; bestacc := acc + t*sl; END IF;
    acc := acc + sl;
  END LOOP;
  RETURN bestacc/total;
END $$;`;

(async () => {
  let su = new Client({ host: HOST, port: PORT, user: 'postgres', database: 'postgres' });
  await su.connect();
  await su.query('DROP DATABASE IF EXISTS kwa_test'); await su.query('DROP ROLE IF EXISTS kwa_app');
  await su.query('CREATE ROLE kwa_app LOGIN NOSUPERUSER NOBYPASSRLS');
  await su.query('CREATE DATABASE kwa_test OWNER kwa_app'); await su.end();

  su = new Client({ host: HOST, port: PORT, user: 'postgres', database: 'kwa_test' });
  await su.connect();
  await su.query('CREATE DOMAIN public.geometry AS text');
  await su.query('CREATE DOMAIN public.geography AS text');
  await su.query("CREATE FUNCTION public.st_geomfromgeojson(text) RETURNS geometry AS $$ SELECT $1::geometry $$ LANGUAGE sql");
  await su.query("CREATE FUNCTION public.st_setsrid(geometry,int) RETURNS geometry AS $$ SELECT $1 $$ LANGUAGE sql");
  await su.query("CREATE FUNCTION public.st_force3d(geometry) RETURNS geometry AS $$ SELECT $1 $$ LANGUAGE sql");
  await su.query("CREATE FUNCTION public.st_force2d(geometry) RETURNS geometry AS $$ SELECT $1 $$ LANGUAGE sql");
  await su.query("CREATE FUNCTION public.st_asgeojson(geometry) RETURNS text AS $$ SELECT $1::text $$ LANGUAGE sql");
  await su.query("CREATE FUNCTION public.st_makepoint(float8,float8) RETURNS geometry AS $$ SELECT ('{\"type\":\"Point\",\"coordinates\":['||$1||','||$2||']}')::geometry $$ LANGUAGE sql");
  await su.query("CREATE FUNCTION public.st_distance(geography,geography) RETURNS float8 AS $$ SELECT 0::float8 $$ LANGUAGE sql");
  await su.query("CREATE FUNCTION public.st_x(geometry) RETURNS float8 AS $$ SELECT (($1::jsonb->'coordinates')->>0)::float8 $$ LANGUAGE sql");
  await su.query("CREATE FUNCTION public.st_y(geometry) RETURNS float8 AS $$ SELECT (($1::jsonb->'coordinates')->>1)::float8 $$ LANGUAGE sql");
  await su.query(LLP);
  await su.query("CREATE CAST (geometry AS geography) WITH INOUT AS IMPLICIT");
  await su.query("CREATE FUNCTION public.kwa_geom_dist(geometry,geometry) RETURNS float8 AS $$ SELECT 0::float8 $$ LANGUAGE sql");
  await su.query("CREATE OPERATOR <-> (LEFTARG=geometry, RIGHTARG=geometry, FUNCTION=public.kwa_geom_dist)");
  await su.end();

  const setup = new Client({ host: HOST, port: PORT, user: 'kwa_app', database: 'kwa_test' });
  await setup.connect();
  for (const f of ['001_schema.sql', '002_rls.sql', '003_seed_demo.sql', '005_auth_dpr_gps.sql', '004_chainage.sql'])
    await setup.query(stub(fs.readFileSync(`${MIG}/${f}`, 'utf8')));
  await setup.end();
  console.log('migrations + real 004 applied with computing ST_LineLocatePoint shim\n');

  const db = new DatabaseService(new ConfigService()); db.onModuleInit();
  const pipes = new PipelinesService(db);

  // a fresh project + a 2 km route (vertical line); midpoint must map to ch 1.000
  await db.withUser(EE, (c) => c.query(
    `INSERT INTO kwa.project(id,name,org_unit_id,status) VALUES($1,'Chainage',$2,'in_progress')`, [P, DIV]));
  try {
    const seg = await pipes.createSegment(EE, {
      projectId: P, name: 'R', chainageFrom: 0, chainageTo: 2,
      geometry: { type: 'LineString', coordinates: [[77.0, 8.0], [77.0, 8.018]] },
    });
    seg.geojson && seg.geojson.includes('LineString') ? ok('createSegment stores + returns GeoJSON') : no('createSegment', seg.geojson);
  } catch (e) { no('createSegment', e.message); }

  try {
    const loc = await pipes.locate(EE, P, 77.0, 8.009); // midpoint
    (loc && Math.abs(loc.chainage - 1.0) < 0.001)
      ? ok(`locate: midpoint → chainage ${loc.chainage} (real ST_LineLocatePoint)`)
      : no('locate chainage', JSON.stringify(loc));
  } catch (e) { no('locate', e.message); }

  try {
    const loc = await pipes.locate(EE, P, 77.0, 8.0045); // quarter point → 0.5 km
    (loc && Math.abs(loc.chainage - 0.5) < 0.001) ? ok('locate: quarter-point → chainage 0.5') : no('quarter chainage', JSON.stringify(loc));
  } catch (e) { no('locate quarter', e.message); }

  try {
    const pr = await pipes.progress(EE, P);
    (pr.plannedKm === 2 && pr.actualKm === 0 && pr.physicalPercent === 0)
      ? ok('progress: planned 2km, laid 0, 0%') : no('progress', JSON.stringify(pr));
  } catch (e) { no('progress', e.message); }

  await db.onModuleDestroy();
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR:', e.message); process.exit(2); });
