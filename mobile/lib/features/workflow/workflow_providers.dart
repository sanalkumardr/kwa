import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/providers.dart';
import 'workflow_models.dart';

/// The signed-in user's profile, used to decide which actions to show.
final meProvider = FutureProvider<Me>((ref) async {
  return Me.fromJson(await ref.watch(apiClientProvider).me());
});

final milestonesProvider =
    FutureProvider.family<List<Milestone>, String>((ref, projectId) async {
  final raw = await ref.watch(apiClientProvider).getMilestones(projectId);
  return raw.map(Milestone.fromJson).toList(growable: false);
});

final mbEntriesProvider =
    FutureProvider.family<List<MbEntry>, String>((ref, milestoneId) async {
  final raw = await ref.watch(apiClientProvider).getMbEntries(milestoneId);
  return raw.map(MbEntry.fromJson).toList(growable: false);
});

final billsProvider =
    FutureProvider.family<List<Bill>, String>((ref, projectId) async {
  final raw = await ref.watch(apiClientProvider).getBills(projectId);
  return raw.map(Bill.fromJson).toList(growable: false);
});

final deductionsProvider =
    FutureProvider.family<List<Deduction>, String>((ref, billId) async {
  final raw = await ref.watch(apiClientProvider).getDeductions(billId);
  return raw.map(Deduction.fromJson).toList(growable: false);
});

final issuesProvider =
    FutureProvider.family<List<Issue>, String>((ref, projectId) async {
  final raw = await ref.watch(apiClientProvider).getIssues(projectId);
  return raw.map(Issue.fromJson).toList(growable: false);
});

final qualityProvider =
    FutureProvider.family<List<QualityTest>, String>((ref, projectId) async {
  final raw = await ref.watch(apiClientProvider).getQualityTests(projectId);
  return raw.map(QualityTest.fromJson).toList(growable: false);
});

final documentsProvider =
    FutureProvider.family<List<Document>, String>((ref, projectId) async {
  final raw = await ref.watch(apiClientProvider).getDocuments(projectId);
  return raw.map(Document.fromJson).toList(growable: false);
});

/// Division rollup for the leadership dashboard (caller's whole scope).
final rollupProvider = FutureProvider<List<RollupRow>>((ref) async {
  final raw = await ref.watch(apiClientProvider).getRollup();
  return raw.map(RollupRow.fromJson).toList(growable: false);
});
