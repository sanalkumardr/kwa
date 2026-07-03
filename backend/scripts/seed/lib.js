// Shared helpers for the seed loaders: DB connection, transaction-scoped user
// context (for RLS + audit), CSV parsing, KML/GeoJSON LineString extraction, and
// geodesic length (so chainage spans are computed without depending on PostGIS).
const fs = require('fs');
const { Client } = require('pg');

function connect() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  return new Client({ connectionString: url });
}

/** Run fn inside a transaction bound to userId (RLS + audit actor). */
async function withUser(client, userId, fn) {
  await client.query('BEGIN');
  await client.query("SELECT set_config('kwa.current_user_id', $1, true)", [userId]);
  try { const r = await fn(); await client.query('COMMIT'); return r; }
  catch (e) { await client.query('ROLLBACK'); throw e; }
}

/** Minimal CSV parser: handles quoted fields and commas/newlines within quotes. */
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c === '\r') { /* skip */ }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const nonEmpty = rows.filter((r) => r.some((v) => v.trim() !== ''));
  if (nonEmpty.length === 0) return [];
  const header = nonEmpty[0].map((h) => h.trim());
  return nonEmpty.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
}

/** Haversine length (km) of a [[lng,lat],...] polyline. */
function lengthKm(coords) {
  const R = 6371;
  const rad = (d) => (d * Math.PI) / 180;
  let total = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const [lng1, lat1] = coords[i], [lng2, lat2] = coords[i + 1];
    const dLat = rad(lat2 - lat1), dLng = rad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
    total += 2 * R * Math.asin(Math.sqrt(a));
  }
  return total;
}

/** Extract LineStrings from a GeoJSON FeatureCollection / Feature / geometry. */
function fromGeoJson(json) {
  const out = [];
  const pushGeom = (g, name) => {
    if (!g) return;
    if (g.type === 'LineString') out.push({ name, coordinates: g.coordinates.map((c) => [c[0], c[1]]) });
    if (g.type === 'MultiLineString') g.coordinates.forEach((ls, i) =>
      out.push({ name: name ? `${name} ${i + 1}` : null, coordinates: ls.map((c) => [c[0], c[1]]) }));
  };
  if (json.type === 'FeatureCollection') json.features.forEach((f) => pushGeom(f.geometry, f.properties?.name));
  else if (json.type === 'Feature') pushGeom(json.geometry, json.properties?.name);
  else pushGeom(json, null);
  return out;
}

/** Extract LineStrings from KML: one per <LineString>, named by its <Placemark>. */
function fromKml(xml) {
  const out = [];
  const placemarks = xml.split(/<Placemark[\s>]/i).slice(1);
  for (const pm of placemarks) {
    const nameM = pm.match(/<name>([\s\S]*?)<\/name>/i);
    const lsBlocks = pm.match(/<LineString>[\s\S]*?<\/LineString>/gi) || [];
    for (const ls of lsBlocks) {
      const coordM = ls.match(/<coordinates>([\s\S]*?)<\/coordinates>/i);
      if (!coordM) continue;
      const coordinates = coordM[1].trim().split(/\s+/).map((tok) => {
        const [lng, lat] = tok.split(',').map(Number);
        return [lng, lat];
      }).filter((c) => Number.isFinite(c[0]) && Number.isFinite(c[1]));
      if (coordinates.length >= 2) out.push({ name: nameM ? nameM[1].trim() : null, coordinates });
    }
  }
  return out;
}

/** Parse a route file by extension into [{name, coordinates}]. */
function parseRouteFile(file) {
  const text = fs.readFileSync(file, 'utf8');
  if (/\.kml$/i.test(file)) return fromKml(text);
  return fromGeoJson(JSON.parse(text));
}

module.exports = { connect, withUser, parseCsv, lengthKm, fromGeoJson, fromKml, parseRouteFile };
