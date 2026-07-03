import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/providers.dart';
import 'workflow_models.dart';
import 'workflow_providers.dart';

/// QC tests/inspections for a project: list results and record a new one.
class QualityScreen extends ConsumerWidget {
  const QualityScreen({super.key, required this.projectId});
  final String projectId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tests = ref.watch(qualityProvider(projectId));
    return Scaffold(
      appBar: AppBar(title: const Text('Quality Tests')),
      floatingActionButton: FloatingActionButton.extended(
        icon: const Icon(Icons.science_outlined),
        label: const Text('Record'),
        onPressed: () => _record(context, ref),
      ),
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(qualityProvider(projectId)),
        child: tests.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (e, _) => ListView(children: [Center(child: Text('Error: $e'))]),
          data: (items) => items.isEmpty
              ? const Center(child: Text('No tests recorded.'))
              : ListView.separated(
                  itemCount: items.length,
                  separatorBuilder: (_, __) => const Divider(height: 1),
                  itemBuilder: (_, i) => _TestTile(test: items[i]),
                ),
        ),
      ),
    );
  }

  Future<void> _record(BuildContext context, WidgetRef ref) async {
    String type = 'hydro';
    String result = 'pass';
    final valueCtrl = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Record quality test'),
        content: StatefulBuilder(
          builder: (_, setState) => Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              DropdownButtonFormField<String>(
                value: type,
                decoration: const InputDecoration(labelText: 'Test'),
                items: const [
                  DropdownMenuItem(value: 'hydro', child: Text('Hydro')),
                  DropdownMenuItem(value: 'pressure', child: Text('Pressure')),
                  DropdownMenuItem(value: 'compaction', child: Text('Compaction')),
                  DropdownMenuItem(value: 'material', child: Text('Material')),
                ],
                onChanged: (v) => setState(() => type = v ?? 'hydro'),
              ),
              DropdownButtonFormField<String>(
                value: result,
                decoration: const InputDecoration(labelText: 'Result'),
                items: const [
                  DropdownMenuItem(value: 'pass', child: Text('Pass')),
                  DropdownMenuItem(value: 'fail', child: Text('Fail')),
                ],
                onChanged: (v) => setState(() => result = v ?? 'pass'),
              ),
              TextField(
                controller: valueCtrl,
                decoration: const InputDecoration(labelText: 'Reading / ref'),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Cancel')),
          FilledButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Save')),
        ],
      ),
    );
    if (ok != true) return;
    final now = DateTime.now();
    await ref.read(apiClientProvider).createQualityTest({
      'projectId': projectId,
      'testType': type,
      'result': result,
      'value': valueCtrl.text.trim(),
      'testedAt':
          '${now.year}-${now.month.toString().padLeft(2, '0')}-${now.day.toString().padLeft(2, '0')}',
    });
    ref.invalidate(qualityProvider(projectId));
  }
}

class _TestTile extends StatelessWidget {
  const _TestTile({required this.test});
  final QualityTest test;

  @override
  Widget build(BuildContext context) {
    final pass = test.result == 'pass';
    return ListTile(
      leading: Icon(
        pass ? Icons.check_circle : Icons.cancel,
        color: pass ? Colors.green : Colors.red,
      ),
      title: Text('${test.testType ?? "—"} · ${test.result ?? "—"}'),
      subtitle: Text('${test.value ?? ""}  ${test.testedAt ?? ""}'.trim()),
    );
  }
}
