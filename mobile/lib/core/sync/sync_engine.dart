import 'dart:async';
import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:sqflite/sqflite.dart';

import '../db/local_db.dart';
import '../net/api_client.dart';
import 'photo_upload_queue.dart';

enum SyncPhase { idle, pushing, pulling, error }

class SyncStatus {
  const SyncStatus(this.phase, {this.pending = 0, this.message});
  final SyncPhase phase;
  final int pending; // outbox depth
  final String? message;
}

/// The offline-first sync engine — the single most important piece of Phase 0.
///
/// Contract:
///   1. All local writes append to `outbox` (done by the repository).
///   2. `sync()` PUSHES the outbox in order, then PULLS server changes since
///      the watermark, then drains the photo queue.
///   3. Conflict policy for DPR (an operational entity) is **server-wins by
///      updated_at**: on pull, a server row overwrites the local row only if it
///      is newer OR the local row has no unsynced edits. Financial/legal
///      entities (MB, bills) would instead be append-only — not handled here
///      because Phase 0 is deliberately DPR-only.
///   4. Everything is idempotent and safe to call repeatedly: a crash mid-sync
///      just leaves outbox rows that get retried next run.
class SyncEngine {
  SyncEngine({
    required this.localDb,
    required this.api,
    required this.photos,
  });

  final LocalDb localDb;
  final ApiClient api;
  final PhotoUploadQueue photos;

  final _controller = StreamController<SyncStatus>.broadcast();
  Stream<SyncStatus> get status => _controller.stream;
  bool _running = false;

  Database get _db => localDb.db;

  /// Run a full sync cycle. Coalesces concurrent calls — if a sync is already
  /// running, this returns immediately rather than overlapping.
  Future<void> sync() async {
    if (_running) return;
    _running = true;
    // Run the three phases independently: a transient push failure (offline)
    // or a quarantined poison row must not prevent pull or the photo queue from
    // making progress. Surface the first error, if any.
    Object? firstError;
    try {
      try {
        await _push();
      } catch (e) {
        firstError ??= e;
      }
      try {
        await _pull();
      } catch (e) {
        firstError ??= e;
      }
      try {
        await photos.drain();
      } catch (e) {
        firstError ??= e;
      }
      _emit(firstError == null ? SyncPhase.idle : SyncPhase.error,
          message: firstError?.toString());
    } finally {
      _running = false;
    }
  }

  /// A 4xx (except 408/429) means the server will never accept this payload —
  /// retrying is futile, so the row is quarantined rather than blocking forever.
  bool _isPermanent(Object e) {
    if (e is DioException && e.response != null) {
      final code = e.response!.statusCode ?? 0;
      return code >= 400 && code < 500 && code != 408 && code != 429;
    }
    return false;
  }

  // -- PUSH ------------------------------------------------------------

  // Sentinel: attempts >= _quarantine marks a poison row to skip in future.
  static const int _quarantine = 900;

  Future<void> _push() async {
    // Exclude already-quarantined rows.
    final rows = await _db.query('outbox',
        where: 'attempts < ?', whereArgs: [_quarantine], orderBy: 'seq ASC');
    _emit(SyncPhase.pushing, pending: rows.length);

    // Per-id ordering: once a row for an id is quarantined or transiently
    // fails, later rows for the SAME id must wait — don't reorder a row's edits.
    final blockedIds = <String>{};

    for (final row in rows) {
      final seq = row['seq'] as int;
      final entity = row['entity'] as String;
      final entityId = row['entity_id'] as String;
      if (blockedIds.contains(entityId)) continue;

      final payload =
          jsonDecode(row['payload'] as String) as Map<String, Object?>;
      try {
        if (entity == 'dpr') {
          final serverRow = await api.pushDpr(payload);
          await _db.update(
            'dpr',
            {'synced': 1, 'updated_at': serverRow['updatedAt']},
            where: 'id = ?',
            whereArgs: [serverRow['id']],
          );
        }
        await _db.delete('outbox', where: 'seq = ?', whereArgs: [seq]);
      } catch (e) {
        if (_isPermanent(e)) {
          // Quarantine this row (kept for inspection via last_error) and skip
          // later edits of the same id; other ids continue to sync.
          await _db.update(
            'outbox',
            {'attempts': _quarantine, 'last_error': 'permanent: $e'},
            where: 'seq = ?',
            whereArgs: [seq],
          );
          blockedIds.add(entityId);
          continue;
        }
        // Transient (offline / 5xx): bump and abort the cycle to retry next
        // time, preserving this id's order.
        await _db.update(
          'outbox',
          {'attempts': (row['attempts'] as int) + 1, 'last_error': e.toString()},
          where: 'seq = ?',
          whereArgs: [seq],
        );
        rethrow;
      }
    }
  }

  // -- PULL ------------------------------------------------------------

  Future<void> _pull() async {
    _emit(SyncPhase.pulling);
    final since = await _watermark('dpr');
    final changes = await api.pullDpr(since);

    DateTime? maxSeen = since;
    final batch = _db.batch();
    for (final j in changes) {
      final id = j['id'] as String;
      final serverUpdated = DateTime.parse(j['updatedAt'] as String);
      maxSeen = (maxSeen == null || serverUpdated.isAfter(maxSeen))
          ? serverUpdated
          : maxSeen;

      // server-wins, but never clobber a row with an un-pushed local edit.
      // Source of truth for "pending" is a non-quarantined outbox row; the
      // synced flag is a secondary signal.
      final pending = await _db.query('outbox',
          where: 'entity_id = ? AND attempts < ?',
          whereArgs: [id, _quarantine],
          limit: 1);
      final local = await _db.query('dpr',
          where: 'id = ?', whereArgs: [id], limit: 1);
      final hasUnsyncedLocal = pending.isNotEmpty ||
          (local.isNotEmpty && (local.first['synced'] as int) == 0);
      if (hasUnsyncedLocal) {
        // local change still pending; it will push and win on the next cycle
        continue;
      }

      batch.insert(
        'dpr',
        {
          'id': id,
          'project_id': j['projectId'],
          'report_date': j['reportDate'],
          'weather': j['weather'],
          'length_laid_today_m': j['lengthLaidTodayM'],
          'chainage_reached': j['chainageReached'],
          'work_done': j['workDone'],
          'work_planned': j['workPlanned'],
          'blockers': j['blockers'],
          'status': j['status'] ?? 'draft',
          'lat': j['lat'],
          'lng': j['lng'],
          'chainage': j['chainage'],
          'updated_at': j['updatedAt'],
          'deleted': (j['deleted'] == true) ? 1 : 0,
          'synced': 1,
        },
        conflictAlgorithm: ConflictAlgorithm.replace,
      );
    }
    await batch.commit(noResult: true);
    if (maxSeen != null) await _setWatermark('dpr', maxSeen);
  }

  // -- watermark -------------------------------------------------------

  Future<DateTime?> _watermark(String entity) async {
    final r = await _db.query('sync_state',
        where: 'entity = ?', whereArgs: [entity], limit: 1);
    if (r.isEmpty || r.first['last_pulled_at'] == null) return null;
    return DateTime.parse(r.first['last_pulled_at'] as String);
  }

  Future<void> _setWatermark(String entity, DateTime ts) async {
    await _db.insert(
      'sync_state',
      {'entity': entity, 'last_pulled_at': ts.toUtc().toIso8601String()},
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  /// Outbox rows still awaiting push (excludes quarantined poison rows).
  Future<int> pendingCount() async {
    final r = await _db.rawQuery(
        'SELECT COUNT(*) AS c FROM outbox WHERE attempts < ?', [_quarantine]);
    return (r.first['c'] as int);
  }

  /// Rows the server permanently rejected — surfaced for manual inspection.
  Future<int> quarantinedCount() async {
    final r = await _db.rawQuery(
        'SELECT COUNT(*) AS c FROM outbox WHERE attempts >= ?', [_quarantine]);
    return (r.first['c'] as int);
  }

  void _emit(SyncPhase phase, {int pending = 0, String? message}) {
    _controller.add(SyncStatus(phase, pending: pending, message: message));
  }

  void dispose() => _controller.close();
}
