import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'auth_controller.dart';
import 'db/local_db.dart';
import 'net/api_client.dart';
import 'sync/photo_upload_queue.dart';
import 'sync/sync_engine.dart';
import '../features/dpr/dpr_repository.dart';

/// --- Configuration -------------------------------------------------------
/// Point at your running NestJS backend.
const String kBaseUrl = String.fromEnvironment(
  'KWA_API_BASE_URL',
  defaultValue: 'http://10.0.2.2:3000', // Android emulator -> host localhost
);

/// LocalDb is async to open; expose via FutureProvider and read elsewhere.
final localDbProvider = FutureProvider<LocalDb>((ref) => LocalDb.open());

final apiClientProvider = Provider<ApiClient>((ref) {
  return ApiClient(
    baseUrl: kBaseUrl,
    tokenProvider: () => ref.read(authProvider).valueOrNull,
    onUnauthorized: () => ref.read(authProvider.notifier).logout(),
  );
});

final photoQueueProvider = Provider<PhotoUploadQueue>((ref) {
  final db = ref.watch(localDbProvider).requireValue;
  return PhotoUploadQueue(localDb: db, api: ref.watch(apiClientProvider));
});

final syncEngineProvider = Provider<SyncEngine>((ref) {
  final db = ref.watch(localDbProvider).requireValue;
  final engine = SyncEngine(
    localDb: db,
    api: ref.watch(apiClientProvider),
    photos: ref.watch(photoQueueProvider),
  );
  ref.onDispose(engine.dispose);
  return engine;
});

final dprRepositoryProvider = Provider<DprRepository>((ref) {
  final db = ref.watch(localDbProvider).requireValue;
  final repo = DprRepository(db);
  ref.onDispose(repo.dispose);
  return repo;
});

/// Live sync status for the UI banner.
final syncStatusProvider = StreamProvider<SyncStatus>((ref) {
  return ref.watch(syncEngineProvider).status;
});

/// Triggers a sync whenever connectivity is (re)gained. This is the "push on
/// reconnect" half of the offline-first contract.
final connectivityTriggerProvider = Provider<StreamSubscription>((ref) {
  final engine = ref.watch(syncEngineProvider);
  final sub = Connectivity().onConnectivityChanged.listen((results) {
    final online = results.any((r) => r != ConnectivityResult.none);
    if (online) unawaited(engine.sync());
  });
  ref.onDispose(sub.cancel);
  return sub;
});
