import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'workflow_models.dart';
import 'workflow_providers.dart';

/// Division rollup dashboard: every project in the user's scope with its
/// physical progress (planned vs laid km), financial position (certified vs
/// paid), and open-issue count. Read-only, online.
class DashboardScreen extends ConsumerWidget {
  const DashboardScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final rollup = ref.watch(rollupProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Division Rollup')),
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(rollupProvider),
        child: rollup.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (e, _) => ListView(children: [Center(child: Text('Error: $e'))]),
          data: (rows) => rows.isEmpty
              ? const Center(child: Text('No projects in scope.'))
              : ListView(
                  padding: const EdgeInsets.all(12),
                  children: [
                    _Totals(rows: rows),
                    const SizedBox(height: 8),
                    for (final r in rows) _ProjectCard(row: r),
                  ],
                ),
        ),
      ),
    );
  }
}

class _Totals extends StatelessWidget {
  const _Totals({required this.rows});
  final List<RollupRow> rows;

  @override
  Widget build(BuildContext context) {
    final certified = rows.fold<double>(0, (s, r) => s + r.certifiedNet);
    final paid = rows.fold<double>(0, (s, r) => s + r.paid);
    final issues = rows.fold<int>(0, (s, r) => s + r.openIssues);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Text(
          '${rows.length} projects · certified ₹${_lakh(certified)} · '
          'paid ₹${_lakh(paid)} · $issues open issues',
          style: const TextStyle(fontWeight: FontWeight.bold),
        ),
      ),
    );
  }
}

class _ProjectCard extends StatelessWidget {
  const _ProjectCard({required this.row});
  final RollupRow row;

  @override
  Widget build(BuildContext context) {
    final frac = (row.physicalPercent / 100).clamp(0.0, 1.0);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Expanded(child: Text(row.name,
                    style: const TextStyle(fontWeight: FontWeight.w600))),
                if (row.openIssues > 0)
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                    decoration: BoxDecoration(
                      color: Colors.orange.withOpacity(0.2),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Text('${row.openIssues} issues',
                        style: const TextStyle(fontSize: 12)),
                  ),
              ],
            ),
            const SizedBox(height: 6),
            LinearProgressIndicator(value: frac, minHeight: 6),
            const SizedBox(height: 6),
            Text(
              'Physical ${row.physicalPercent.toStringAsFixed(1)}% '
              '(${row.laidKm.toStringAsFixed(2)}/${row.plannedKm.toStringAsFixed(2)} km) · '
              'certified ₹${_lakh(row.certifiedNet)} · paid ₹${_lakh(row.paid)}',
              style: const TextStyle(fontSize: 12),
            ),
          ],
        ),
      ),
    );
  }
}

/// Indian-style lakh formatting for compact money display.
String _lakh(double v) {
  if (v >= 10000000) return '${(v / 10000000).toStringAsFixed(2)} Cr';
  if (v >= 100000) return '${(v / 100000).toStringAsFixed(2)} L';
  return v.toStringAsFixed(0);
}
