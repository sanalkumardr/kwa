import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';
import 'package:image_picker/image_picker.dart';
import 'package:uuid/uuid.dart';

import '../../core/auth_controller.dart';
import '../../core/providers.dart';
import '../../core/sync/sync_engine.dart';
import '../pipeline/pipeline_map_screen.dart';
import '../workflow/bills_screen.dart';
import '../workflow/dashboard_screen.dart';
import '../workflow/documents_screen.dart';
import '../workflow/issues_screen.dart';
import '../workflow/milestones_screen.dart';
import '../workflow/quality_screen.dart';
import 'dpr_model.dart';
import 'dpr_providers.dart';

/// Minimal Phase 0 UI: a sync-status banner, a list of DPRs (each showing
/// whether it's synced), a "+" to create one offline, and a manual sync action.
class DprListScreen extends ConsumerWidget {
  const DprListScreen({super.key, required this.projectId});
  final String projectId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // ensure the reconnect trigger is alive
    ref.watch(connectivityTriggerProvider);
    final dprs = ref.watch(dprListProvider(projectId));
    final status = ref.watch(syncStatusProvider).value;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Daily Progress Reports'),
        actions: [
          IconButton(
            icon: const Icon(Icons.map_outlined),
            tooltip: 'Pipeline route',
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) => PipelineMapScreen(projectId: projectId),
              ),
            ),
          ),
          PopupMenuButton<String>(
            icon: const Icon(Icons.account_tree_outlined),
            tooltip: 'Workflows',
            onSelected: (v) {
              final Widget screen = switch (v) {
                'milestones' => MilestonesScreen(projectId: projectId),
                'bills' => BillsScreen(projectId: projectId),
                'issues' => IssuesScreen(projectId: projectId),
                'quality' => QualityScreen(projectId: projectId),
                'documents' => DocumentsScreen(projectId: projectId),
                _ => const DashboardScreen(),
              };
              Navigator.of(context).push(
                MaterialPageRoute<void>(builder: (_) => screen),
              );
            },
            itemBuilder: (_) => const [
              PopupMenuItem(value: 'milestones', child: Text('Milestones & MB')),
              PopupMenuItem(value: 'bills', child: Text('Bills')),
              PopupMenuItem(value: 'issues', child: Text('Issues')),
              PopupMenuItem(value: 'quality', child: Text('Quality tests')),
              PopupMenuItem(value: 'documents', child: Text('Documents')),
              PopupMenuItem(value: 'dashboard', child: Text('Division rollup')),
            ],
          ),
          IconButton(
            icon: const Icon(Icons.sync),
            onPressed: () => ref.read(syncEngineProvider).sync(),
          ),
          IconButton(
            icon: const Icon(Icons.logout),
            tooltip: 'Sign out',
            onPressed: () => ref.read(authProvider.notifier).logout(),
          ),
        ],
        bottom: status == null
            ? null
            : PreferredSize(
                preferredSize: const Size.fromHeight(24),
                child: _SyncBanner(status: status),
              ),
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () => _createSample(ref),
        child: const Icon(Icons.add),
      ),
      body: dprs.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('Error: $e')),
        data: (items) => items.isEmpty
            ? const Center(child: Text('No reports yet. Tap + to add one.'))
            : ListView.separated(
                itemCount: items.length,
                separatorBuilder: (_, __) => const Divider(height: 1),
                itemBuilder: (_, i) => _DprTile(dpr: items[i]),
              ),
      ),
    );
  }

  Future<void> _createSample(WidgetRef ref) async {
    final repo = ref.read(dprRepositoryProvider);
    final now = DateTime.now();
    final pos = await _currentPosition(); // best-effort GPS tag
    final id = const Uuid().v4();
    await repo.save(Dpr(
      id: id,
      projectId: projectId,
      reportDate:
          '${now.year}-${now.month.toString().padLeft(2, '0')}-${now.day.toString().padLeft(2, '0')}',
      weather: 'Clear',
      lengthLaidTodayM: 120,
      workDone: 'Laid DI 300mm',
      status: 'draft',
      lat: pos?.latitude,
      lng: pos?.longitude,
      updatedAt: now.toUtc(),
    ));

    // Best-effort site photo: captured locally, queued for upload. The queue
    // (drained by the sync engine) survives offline and retries with backoff.
    final photo = await _capturePhoto();
    if (photo != null) {
      await ref.read(photoQueueProvider).enqueue(
            id: const Uuid().v4(),
            entity: 'dpr',
            entityId: id,
            localPath: photo,
          );
    }

    // opportunistic push; harmless if offline (stays in outbox).
    // The server derives chainage from lat/lng and returns it on the next pull.
    await ref.read(syncEngineProvider).sync();
  }

  /// Capture a single photo from the camera; null if cancelled/unavailable.
  Future<String?> _capturePhoto() async {
    try {
      final x = await ImagePicker().pickImage(
        source: ImageSource.camera,
        maxWidth: 2000,
        imageQuality: 80,
      );
      return x?.path;
    } catch (_) {
      return null;
    }
  }

  /// Returns the current GPS fix, or null if permission/services unavailable
  /// (the report is still created — location is best-effort, never blocking).
  Future<Position?> _currentPosition() async {
    try {
      if (!await Geolocator.isLocationServiceEnabled()) return null;
      var perm = await Geolocator.checkPermission();
      if (perm == LocationPermission.denied) {
        perm = await Geolocator.requestPermission();
      }
      if (perm == LocationPermission.denied ||
          perm == LocationPermission.deniedForever) {
        return null;
      }
      return await Geolocator.getCurrentPosition();
    } catch (_) {
      return null;
    }
  }
}

class _DprTile extends StatelessWidget {
  const _DprTile({required this.dpr});
  final Dpr dpr;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      title: Text('${dpr.reportDate} · ${dpr.workDone ?? "—"}'),
      subtitle: Text(
        'Status: ${dpr.status} · '
        '${dpr.lengthLaidTodayM?.toStringAsFixed(0) ?? "0"} m today'
        '${dpr.chainage != null ? " · ch ${dpr.chainage!.toStringAsFixed(3)} km" : ""}',
      ),
      trailing: Icon(
        dpr.synced ? Icons.cloud_done : Icons.cloud_upload_outlined,
        color: dpr.synced ? Colors.green : Colors.orange,
      ),
    );
  }
}

class _SyncBanner extends StatelessWidget {
  const _SyncBanner({required this.status});
  final SyncStatus status;

  @override
  Widget build(BuildContext context) {
    final (text, color) = switch (status.phase) {
      SyncPhase.idle => ('All changes synced', Colors.green),
      SyncPhase.pushing => ('Pushing ${status.pending} change(s)…', Colors.blue),
      SyncPhase.pulling => ('Pulling updates…', Colors.blue),
      SyncPhase.error => ('Offline — will retry: ${status.message}', Colors.orange),
    };
    return Container(
      width: double.infinity,
      color: color.withOpacity(0.15),
      padding: const EdgeInsets.symmetric(vertical: 4, horizontal: 12),
      child: Text(text, style: TextStyle(color: color, fontSize: 12)),
    );
  }
}
