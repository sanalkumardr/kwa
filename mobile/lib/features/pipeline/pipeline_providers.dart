import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/providers.dart';
import 'pipeline_models.dart';

/// Route segments for a project (online fetch; the map is a read-only view).
final segmentsProvider =
    FutureProvider.family<List<PipelineSegment>, String>((ref, projectId) async {
  final api = ref.watch(apiClientProvider);
  final raw = await api.getSegments(projectId);
  return raw.map(PipelineSegment.fromServerJson).toList(growable: false);
});

/// Planned-vs-actual progress for the header.
final progressProvider =
    FutureProvider.family<PipelineProgress, String>((ref, projectId) async {
  final api = ref.watch(apiClientProvider);
  return PipelineProgress.fromServerJson(await api.getProgress(projectId));
});
