import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/providers.dart';
import 'workflow_models.dart';
import 'workflow_providers.dart';

/// Measurement Book entries for a milestone, with the AE→AEE approval actions
/// surfaced according to the signed-in user's role. Approval locks the entry
/// server-side (immutable), reflected here as the "approved" stage.
class MbEntriesScreen extends ConsumerWidget {
  const MbEntriesScreen({
    super.key,
    required this.milestoneId,
    required this.milestoneName,
  });
  final String milestoneId;
  final String milestoneName;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final entries = ref.watch(mbEntriesProvider(milestoneId));
    final role = ref.watch(meProvider).valueOrNull?.role;

    Future<void> act(Future<void> Function() call) async {
      try {
        await call();
        ref.invalidate(mbEntriesProvider(milestoneId));
      } catch (e) {
        if (context.mounted) {
          ScaffoldMessenger.of(context)
              .showSnackBar(SnackBar(content: Text('Failed: $e')));
        }
      }
    }

    return Scaffold(
      appBar: AppBar(title: Text(milestoneName)),
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(mbEntriesProvider(milestoneId)),
        child: entries.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (e, _) => ListView(children: [Center(child: Text('Error: $e'))]),
          data: (items) => items.isEmpty
              ? const Center(child: Text('No measurements yet.'))
              : ListView.separated(
                  itemCount: items.length,
                  separatorBuilder: (_, __) => const Divider(height: 1),
                  itemBuilder: (_, i) => _MbTile(
                    entry: items[i],
                    role: role,
                    onCheck: (id) =>
                        act(() => ref.read(apiClientProvider).checkMb(id).then((_) {})),
                    onApprove: (id) => act(() =>
                        ref.read(apiClientProvider).approveMb(id).then((_) {})),
                  ),
                ),
        ),
      ),
    );
  }
}

class _MbTile extends StatelessWidget {
  const _MbTile({
    required this.entry,
    required this.role,
    required this.onCheck,
    required this.onApprove,
  });

  final MbEntry entry;
  final String? role;
  final void Function(String id) onCheck;
  final void Function(String id) onApprove;

  @override
  Widget build(BuildContext context) {
    final canCheck = role == 'ae' && entry.stage == 'measured';
    final canApprove = (role == 'aee' || role == 'ee') && entry.stage == 'checked';

    return ListTile(
      title: Text(
        '${entry.quantity.toStringAsFixed(2)} ${entry.unit ?? ""}'
        ' @ ₹${entry.rateSnapshot.toStringAsFixed(2)}'
        '  =  ₹${entry.amount.toStringAsFixed(2)}',
      ),
      subtitle: Text(
        'ch ${entry.chainageFrom?.toStringAsFixed(3) ?? "—"}'
        ' → ${entry.chainageTo?.toStringAsFixed(3) ?? "—"}'
        ' · ${entry.stage}',
      ),
      trailing: canCheck
          ? TextButton(onPressed: () => onCheck(entry.id), child: const Text('Check'))
          : canApprove
              ? FilledButton(
                  onPressed: () => onApprove(entry.id),
                  child: const Text('Approve'))
              : Icon(
                  entry.locked ? Icons.lock : Icons.lock_open,
                  size: 18,
                  color: entry.locked ? Colors.green : Colors.grey,
                ),
    );
  }
}
