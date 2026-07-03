import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/providers.dart';
import 'dpr_model.dart';

/// Stream of DPRs for a project, re-emitting whenever the local store changes
/// (after a save) so the list stays live without manual refresh.
final dprListProvider =
    StreamProvider.family<List<Dpr>, String>((ref, projectId) async* {
  final repo = ref.watch(dprRepositoryProvider);
  yield await repo.listByProject(projectId);
  await for (final _ in repo.changes) {
    yield await repo.listByProject(projectId);
  }
});
