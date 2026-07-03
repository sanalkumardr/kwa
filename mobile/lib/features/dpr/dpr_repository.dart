import 'dart:async';

import 'package:sqflite/sqflite.dart';

import '../../core/db/local_db.dart';
import 'dpr_model.dart';

/// Offline-first repository for DPRs.
///
/// The golden rule: a write updates the LOCAL row and appends to the outbox in
/// a single transaction, then returns. It never touches the network. The
/// SyncEngine mirrors the outbox to the server later. Reads always come from
/// the local store, so the UI works identically online and offline.
class DprRepository {
  DprRepository(this.localDb);
  final LocalDb localDb;
  Database get _db => localDb.db;

  final _changes = StreamController<void>.broadcast();
  Stream<void> get changes => _changes.stream;

  Future<List<Dpr>> listByProject(String projectId) async {
    final rows = await _db.query(
      'dpr',
      where: 'project_id = ? AND deleted = 0',
      whereArgs: [projectId],
      orderBy: 'report_date DESC',
    );
    return rows.map(Dpr.fromRow).toList(growable: false);
  }

  /// Create or update a DPR locally and enqueue it for push.
  Future<Dpr> save(Dpr dpr) async {
    final stamped = dpr.copyWith(
      updatedAt: DateTime.now().toUtc(),
      synced: false,
    );
    await _db.transaction((txn) async {
      await txn.insert(
        'dpr',
        stamped.toRow(),
        conflictAlgorithm: ConflictAlgorithm.replace,
      );
      await txn.insert('outbox', {
        'entity': 'dpr',
        'entity_id': stamped.id,
        'op': stamped.deleted ? 'delete' : 'upsert',
        'payload': stamped.encodePayload(),
        'created_at': DateTime.now().toUtc().toIso8601String(),
        'attempts': 0,
      });
    });
    _changes.add(null);
    return stamped;
  }

  /// Soft-delete (sync envelope: never hard-delete).
  Future<void> remove(Dpr dpr) async {
    await save(dpr.copyWith(deleted: true));
  }

  void dispose() => _changes.close();
}
