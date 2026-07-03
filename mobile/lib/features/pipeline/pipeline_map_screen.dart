import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:latlong2/latlong.dart';

import 'pipeline_models.dart';
import 'pipeline_providers.dart';

/// Map view of the route: each reach drawn as a polyline coloured by status,
/// with a planned-vs-actual progress header. Read-only (online) — the offline
/// write path is DPR (Phase 0); GIS is reference data pulled when connected.
class PipelineMapScreen extends ConsumerWidget {
  const PipelineMapScreen({super.key, required this.projectId});
  final String projectId;

  static Color statusColor(String status) => switch (status) {
        'laid' => Colors.green,
        'tested' => Colors.blue,
        'in_progress' => Colors.orange,
        _ => Colors.grey, // planned
      };

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final segments = ref.watch(segmentsProvider(projectId));
    final progress = ref.watch(progressProvider(projectId));

    return Scaffold(
      appBar: AppBar(
        title: const Text('Pipeline Route'),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(40),
          child: progress.when(
            loading: () => const SizedBox(height: 40),
            error: (_, __) => const SizedBox(height: 40),
            data: (p) => _ProgressHeader(progress: p),
          ),
        ),
      ),
      body: segments.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('Could not load route: $e')),
        data: (segs) => _Map(segments: segs),
      ),
    );
  }
}

class _Map extends StatelessWidget {
  const _Map({required this.segments});
  final List<PipelineSegment> segments;

  @override
  Widget build(BuildContext context) {
    final allPoints = [for (final s in segments) ...s.points];
    if (allPoints.isEmpty) {
      return const Center(child: Text('No route geometry for this project.'));
    }
    final center = _centroid(allPoints);

    return FlutterMap(
      options: MapOptions(initialCenter: center, initialZoom: 13),
      children: [
        TileLayer(
          urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
          userAgentPackageName: 'in.kwa.pipeline',
        ),
        PolylineLayer(
          polylines: [
            for (final s in segments)
              if (s.points.length >= 2)
                Polyline(
                  points: s.points,
                  strokeWidth: 5,
                  color: PipelineMapScreen.statusColor(s.status),
                ),
          ],
        ),
      ],
    );
  }

  LatLng _centroid(List<LatLng> pts) {
    var lat = 0.0, lng = 0.0;
    for (final p in pts) {
      lat += p.latitude;
      lng += p.longitude;
    }
    return LatLng(lat / pts.length, lng / pts.length);
  }
}

class _ProgressHeader extends StatelessWidget {
  const _ProgressHeader({required this.progress});
  final PipelineProgress progress;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 40,
      padding: const EdgeInsets.symmetric(horizontal: 12),
      alignment: Alignment.centerLeft,
      child: Text(
        'Physical: ${progress.physicalPercent.toStringAsFixed(1)}%  ·  '
        'laid ${progress.actualKm.toStringAsFixed(2)} / '
        '${progress.plannedKm.toStringAsFixed(2)} km',
        style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500),
      ),
    );
  }
}
