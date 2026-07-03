// Load a Schedule of Rates edition + items so the financial logic has real
// rates to multiply against tender premiums.
//
//   node scripts/seed/load-sor.js <file.csv|file.json> \
//        --code KWA-2025-26 --title "KWA SOR 2025-26" --authority KWA \
//        --from 2025-04-01 [--user <app_user uuid>]
//
// CSV columns: item_code,description,unit,base_rate,chapter
// JSON: [{ "itemCode","description","unit","baseRate","chapter" }, ...]
const fs = require('fs');
const { connect, withUser, parseCsv } = require('./lib');

function readItems(file) {
  if (/\.json$/i.test(file)) {
    return JSON.parse(fs.readFileSync(file, 'utf8')).map((r) => ({
      item_code: r.itemCode ?? r.item_code,
      description: r.description ?? null,
      unit: r.unit ?? null,
      base_rate: Number(r.baseRate ?? r.base_rate),
      chapter: r.chapter ?? null,
    }));
  }
  return parseCsv(fs.readFileSync(file, 'utf8')).map((r) => ({
    item_code: r.item_code,
    description: r.description || null,
    unit: r.unit || null,
    base_rate: Number(r.base_rate),
    chapter: r.chapter || null,
  }));
}

/** Upsert an edition and its items. Returns { editionId, items }. */
async function loadSor(client, { file, code, title, authority, from, user }) {
  const items = readItems(file);
  for (const it of items) {
    if (!it.item_code) throw new Error('row missing item_code');
    if (!Number.isFinite(it.base_rate)) throw new Error(`bad base_rate for ${it.item_code}`);
  }
  return withUser(client, user, async () => {
    const ed = await client.query(
      `INSERT INTO kwa.sor_edition (code, title, authority, effective_from, status, published_by, created_by)
       VALUES ($1,$2,$3,$4,'published',$5,$5)
       ON CONFLICT (code) DO UPDATE SET
         title = EXCLUDED.title, authority = EXCLUDED.authority,
         effective_from = EXCLUDED.effective_from, status = 'published'
       RETURNING id`,
      [code, title ?? code, authority ?? null, from ?? null, user],
    );
    const editionId = ed.rows[0].id;
    for (const it of items) {
      await client.query(
        `INSERT INTO kwa.sor_item (edition_id, item_code, description, unit, base_rate, chapter, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (edition_id, item_code) DO UPDATE SET
           description = EXCLUDED.description, unit = EXCLUDED.unit,
           base_rate = EXCLUDED.base_rate, chapter = EXCLUDED.chapter`,
        [editionId, it.item_code, it.description, it.unit, it.base_rate, it.chapter, user],
      );
    }
    return { editionId, items };
  });
}

async function main() {
  const [file] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const opt = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : d; };
  if (!file) { console.error('usage: load-sor.js <file> --code CODE [--title --authority --from --user]'); process.exit(1); }
  const client = connect(); await client.connect();
  try {
    const { editionId, items } = await loadSor(client, {
      file, code: opt('code'), title: opt('title'), authority: opt('authority'),
      from: opt('from'), user: opt('user', '22222222-0000-0000-0000-000000000001'),
    });
    console.log(`SOR: edition ${editionId} loaded with ${items.length} items`);
  } finally { await client.end(); }
}

if (require.main === module) main().catch((e) => { console.error('load-sor failed:', e.message); process.exit(1); });
module.exports = { loadSor };
