import 'package:sqflite/sqflite.dart';

import '../db/local_db.dart';
import '../net/api_client.dart';

/// Uploads queued photos with exponential backoff. Photos are queued locally
/// the instant they're captured (so field staff never wait on a network), then
/// drained opportunistically by the SyncEngine. Each success writes the server
/// object key back onto the queue row; the owning entity references it later.
class PhotoUploadQueue {
  PhotoUploadQueue({required this.localDb, required this.api});

  final LocalDb localDb;
  final ApiClient api;

  static const _maxAttempts = 8;
  Database get _db => localDb.db;

  Future<void> enqueue({
    required String id,
    required String entity,
    required String entityId,
    required String localPath,
  }) async {
    await _db.insert('photo_queue', {
      'id': id,
      'entity': entity,
      'entity_id': entityId,
      'local_path': localPath,
      'status': 'pending',
      'attempts': 0,
    });
  }

  /// Attempt every due photo once. Failures reschedule with backoff and do not
  /// abort the rest of the queue (unlike the ordered outbox, photos are
  /// independent of each other).
  Future<void> drain() async {
    final now = DateTime.now().toUtc();
    final due = await _db.query(
      'photo_queue',
      where: "status IN ('pending','failed') AND "
          "(next_try_at IS NULL OR next_try_at <= ?)",
      whereArgs: [now.toIso8601String()],
      orderBy: 'attempts ASC',
    );

    for (final row in due) {
      final id = row['id'] as String;
      final attempts = row['attempts'] as int;
      if (attempts >= _maxAttempts) continue; // give up; surfaced in UI

      await _db.update('photo_queue', {'status': 'uploading'},
          where: 'id = ?', whereArgs: [id]);
      try {
        final key = await api.uploadPhoto(
          entity: row['entity'] as String,
          entityId: row['entity_id'] as String,
          filePath: row['local_path'] as String,
        );
        await _db.update(
          'photo_queue',
          {'status': 'done', 'remote_key': key, 'last_error': null},
          where: 'id = ?',
          whereArgs: [id],
        );
      } catch (e) {
        final nextAttempt = attempts + 1;
        final delay = _backoff(nextAttempt);
        await _db.update(
          'photo_queue',
          {
            'status': 'failed',
            'attempts': nextAttempt,
            'next_try_at':
                DateTime.now().toUtc().add(delay).toIso8601String(),
            'last_error': e.toString(),
          },
          where: 'id = ?',
          whereArgs: [id],
        );
      }
    }
  }

  /// 2^n seconds, capped at 5 minutes.
  Duration _backoff(int attempt) {
    final secs = (1 << attempt).clamp(1, 300);
    return Duration(seconds: secs);
  }
}
