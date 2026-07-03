import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'mb_entries_screen.dart';
import 'workflow_providers.dart';

class MilestonesScreen extends ConsumerWidget {
  const MilestonesScreen({super.key, required this.projectId});
  final String projectId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final milestones = ref.watch(milestonesProvider(projectId));
    return Scaffold(
      appBar: AppBar(title: const Text('Milestones')),
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(milestonesProvider(projectId)),
        child: milestones.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (e, _) => ListView(children: [Center(child: Text('Error: $e'))]),
          data: (items) => items.isEmpty
              ? const Center(child: Text('No milestones.'))
              : ListView.separated(
                  itemCount: items.length,
                  separatorBuilder: (_, __) => const Divider(height: 1),
                  itemBuilder: (_, i) {
                    final m = items[i];
                    return ListTile(
                      title: Text(m.name),
                      subtitle: Text(
                        'ch ${m.chainageFrom?.toStringAsFixed(3) ?? "—"}'
                        ' → ${m.chainageTo?.toStringAsFixed(3) ?? "—"} km'
                        ' · ${m.status}',
                      ),
                      trailing: const Icon(Icons.chevron_right),
                      onTap: () => Navigator.of(context).push(
                        MaterialPageRoute<void>(
                          builder: (_) => MbEntriesScreen(
                            milestoneId: m.id,
                            milestoneName: m.name,
                          ),
                        ),
                      ),
                    );
                  },
                ),
        ),
      ),
    );
  }
}
