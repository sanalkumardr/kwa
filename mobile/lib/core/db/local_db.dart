import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:sqflite/sqflite.dart';

/// Opens and migrates the local SQLite database.
///
/// Mirrors the server's sync contract: every domain row carries
/// id / updated_at / deleted / synced. Writes never block on the network —
/// they land here first and are mirrored to the server by the SyncEngine via
/// the `outbox` table. The `photo_queue` handles binary uploads separately,
/// and `sync_state` holds the pull watermark.
class LocalDb {
  LocalDb._(this.db);
  final Database db;

  static Future<LocalDb> open() async {
    final dir = await getApplicationDocumentsDirectory();
    final path = p.join(dir.path, 'kwa.db');
    final db = await openDatabase(
      path,
      version: 2,
      onConfigure: (db) => db.execute('PRAGMA foreign_keys = ON'),
      onCreate: _create,
      onUpgrade: _upgrade,
    );
    return LocalDb._(db);
  }

  static Future<void> _upgrade(Database db, int from, int to) async {
    if (from < 2) {
      await db.execute('ALTER TABLE dpr ADD COLUMN lat REAL');
      await db.execute('ALTER TABLE dpr ADD COLUMN lng REAL');
      await db.execute('ALTER TABLE dpr ADD COLUMN chainage REAL');
    }
  }

  static Future<void> _create(Database db, int version) async {
    // DPR — the single Phase 0 entity. Columns map 1:1 to the server table.
    await db.execute('''
      CREATE TABLE dpr (
        id                  TEXT PRIMARY KEY,
        project_id          TEXT NOT NULL,
        report_date         TEXT NOT NULL,
        weather             TEXT,
        length_laid_today_m REAL,
        chainage_reached    REAL,
        work_done           TEXT,
        work_planned        TEXT,
        blockers            TEXT,
        status              TEXT NOT NULL DEFAULT 'draft',
        -- location (lat/lng captured on device; chainage derived server-side)
        lat                 REAL,
        lng                 REAL,
        chainage            REAL,
        -- sync envelope
        updated_at          TEXT NOT NULL,
        deleted             INTEGER NOT NULL DEFAULT 0,
        synced              INTEGER NOT NULL DEFAULT 0
      )
    ''');

    // Outbox: ordered queue of local mutations awaiting push.
    // One row per change; payload is the full entity snapshot as JSON.
    await db.execute('''
      CREATE TABLE outbox (
        seq         INTEGER PRIMARY KEY AUTOINCREMENT,
        entity      TEXT NOT NULL,      -- e.g. 'dpr'
        entity_id   TEXT NOT NULL,
        op          TEXT NOT NULL,      -- 'upsert' | 'delete'
        payload     TEXT NOT NULL,      -- JSON snapshot
        created_at  TEXT NOT NULL,
        attempts    INTEGER NOT NULL DEFAULT 0,
        last_error  TEXT
      )
    ''');

    // Photo upload queue: local file -> server object key, with retry/backoff.
    await db.execute('''
      CREATE TABLE photo_queue (
        id          TEXT PRIMARY KEY,
        entity      TEXT NOT NULL,
        entity_id   TEXT NOT NULL,
        local_path  TEXT NOT NULL,
        remote_key  TEXT,              -- set once uploaded
        status      TEXT NOT NULL DEFAULT 'pending', -- pending|uploading|done|failed
        attempts    INTEGER NOT NULL DEFAULT 0,
        next_try_at TEXT,
        last_error  TEXT
      )
    ''');

    // Watermark + last sync metadata, keyed by entity.
    await db.execute('''
      CREATE TABLE sync_state (
        entity         TEXT PRIMARY KEY,
        last_pulled_at TEXT             -- server updated_at high-water mark
      )
    ''');
  }
}
