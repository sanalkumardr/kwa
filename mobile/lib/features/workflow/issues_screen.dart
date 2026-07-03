import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';

import '../../core/providers.dart';
import 'workflow_models.dart';
import 'workflow_providers.dart';

/// Site issues/snags: raise a GPS-pinned issue, see them priority-ordered, and
/// resolve. A core field workflow — issues are reported where they're found.
class IssuesScreen extends ConsumerWidget {
  const IssuesScreen({super.key, required this.projectId});
  final String projectId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final issues = ref.watch(issuesProvider(projectId));

    return Scaffold(
      appBar: AppBar(title: const Text('Issues')),
      floatingActionButton: FloatingActionButton.extended(
        icon: const Icon(Icons.add_location_alt_outlined),
        label: const Text('Raise'),
        onPressed: () => _raise(context, ref),
      ),
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(issuesProvider(projectId)),
        child: issues.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (e, _) => ListView(children: [Center(child: Text('Error: $e'))]),
          data: (items) => items.isEmpty
              ? const Center(child: Text('No issues.'))
              : ListView.separated(
                  itemCount: items.length,
                  separatorBuilder: (_, __) => const Divider(height: 1),
                  itemBuilder: (_, i) => _IssueTile(
                    issue: items[i],
                    onResolve: (id) async {
                      await ref.read(apiClientProvider).setIssueStatus(id, 'resolved');
                      ref.invalidate(issuesProvider(projectId));
                    },
                  ),
                ),
        ),
      ),
    );
  }

  Future<void> _raise(BuildContext context, WidgetRef ref) async {
    final titleCtrl = TextEditingController();
    String priority = 'med';
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Raise issue'),
        content: StatefulBuilder(
          builder: (_, setState) => Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: titleCtrl,
                decoration: const InputDecoration(labelText: 'What is the issue?'),
              ),
              const SizedBox(height: 12),
              DropdownButtonFormField<String>(
                value: priority,
                decoration: const InputDecoration(labelText: 'Priority'),
                items: const [
                  DropdownMenuItem(value: 'low', child: Text('Low')),
                  DropdownMenuItem(value: 'med', child: Text('Medium')),
                  DropdownMenuItem(value: 'high', child: Text('High')),
                ],
                onChanged: (v) => setState(() => priority = v ?? 'med'),
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
              child: const Text('Raise')),
        ],
      ),
    );
    if (ok != true || titleCtrl.text.trim().isEmpty) return;

    final pos = await _currentPosition();
    await ref.read(apiClientProvider).createIssue({
      'projectId': projectId,
      'title': titleCtrl.text.trim(),
      'priority': priority,
      if (pos != null) 'location': [pos.longitude, pos.latitude],
    });
    ref.invalidate(issuesProvider(projectId));
  }

  Future<Position?> _currentPosition() async {
    try {
      if (!await Geolocator.isLocationServiceEnabled()) return null;
      var perm = await Geolocator.checkPermission();
      if (perm == LocationPermission.denied) {
        perm = await Geolocator.requestPermission();
      }
      if (perm == LocationPermission.denied ||
          perm == LocationPermission.deniedForever) return null;
      return await Geolocator.getCurrentPosition();
    } catch (_) {
      return null;
    }
  }
}

class _IssueTile extends StatelessWidget {
  const _IssueTile({required this.issue, required this.onResolve});
  final Issue issue;
  final Future<void> Function(String id) onResolve;

  Color get _priorityColor => switch (issue.priority) {
        'high' => Colors.red,
        'med' => Colors.orange,
        _ => Colors.grey,
      };

  @override
  Widget build(BuildContext context) {
    final resolved = issue.status == 'resolved';
    return ListTile(
      leading: Icon(Icons.flag, color: _priorityColor),
      title: Text(issue.title),
      subtitle: Text(
        '${issue.priority ?? "—"} · ${issue.status}'
        '${issue.lat != null ? " · pinned" : ""}',
      ),
      trailing: resolved
          ? const Icon(Icons.check_circle, color: Colors.green)
          : TextButton(
              onPressed: () => onResolve(issue.id),
              child: const Text('Resolve'),
            ),
    );
  }
}
