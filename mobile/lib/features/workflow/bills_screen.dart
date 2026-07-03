import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/providers.dart';
import 'workflow_models.dart';
import 'workflow_providers.dart';

/// Running bills for a project: review gross/deductions/net, run compute (pull
/// approved MB + apply deduction rules) and certify (locks the bill). Tapping a
/// bill shows the itemised statutory deductions.
class BillsScreen extends ConsumerWidget {
  const BillsScreen({super.key, required this.projectId});
  final String projectId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final bills = ref.watch(billsProvider(projectId));
    final role = ref.watch(meProvider).valueOrNull?.role;

    Future<void> act(Future<void> Function() call) async {
      try {
        await call();
        ref.invalidate(billsProvider(projectId));
      } catch (e) {
        if (context.mounted) {
          ScaffoldMessenger.of(context)
              .showSnackBar(SnackBar(content: Text('Failed: $e')));
        }
      }
    }

    return Scaffold(
      appBar: AppBar(title: const Text('Bills')),
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(billsProvider(projectId)),
        child: bills.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (e, _) => ListView(children: [Center(child: Text('Error: $e'))]),
          data: (items) => items.isEmpty
              ? const Center(child: Text('No bills.'))
              : ListView.separated(
                  itemCount: items.length,
                  separatorBuilder: (_, __) => const Divider(height: 1),
                  itemBuilder: (_, i) => _BillTile(
                    bill: items[i],
                    role: role,
                    onCompute: (id) => act(() =>
                        ref.read(apiClientProvider).computeBill(id).then((_) {})),
                    onCertify: (id) => act(() =>
                        ref.read(apiClientProvider).certifyBill(id).then((_) {})),
                    onTap: (b) => showModalBottomSheet<void>(
                      context: context,
                      builder: (_) => _Deductions(billId: b.id),
                    ),
                  ),
                ),
        ),
      ),
    );
  }
}

class _BillTile extends StatelessWidget {
  const _BillTile({
    required this.bill,
    required this.role,
    required this.onCompute,
    required this.onCertify,
    required this.onTap,
  });
  final Bill bill;
  final String? role;
  final void Function(String id) onCompute;
  final void Function(String id) onCertify;
  final void Function(Bill bill) onTap;

  @override
  Widget build(BuildContext context) {
    final isDraft = bill.status == 'draft';
    final canCertify = (role == 'aee' || role == 'ee') && isDraft;

    return ListTile(
      onTap: () => onTap(bill),
      title: Text('Bill #${bill.runningBillNo} · ${bill.status}'),
      subtitle: Text(
        'gross ₹${bill.gross.toStringAsFixed(2)} · '
        'ded ₹${bill.deductions.toStringAsFixed(2)} · '
        'net ₹${bill.net.toStringAsFixed(2)}',
      ),
      trailing: isDraft
          ? Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextButton(
                    onPressed: () => onCompute(bill.id),
                    child: const Text('Compute')),
                if (canCertify)
                  FilledButton(
                      onPressed: () => onCertify(bill.id),
                      child: const Text('Certify')),
              ],
            )
          : const Icon(Icons.lock, size: 18, color: Colors.green),
    );
  }
}

class _Deductions extends ConsumerWidget {
  const _Deductions({required this.billId});
  final String billId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ded = ref.watch(deductionsProvider(billId));
    return SafeArea(
      child: ded.when(
        loading: () => const Padding(
          padding: EdgeInsets.all(24),
          child: Center(child: CircularProgressIndicator()),
        ),
        error: (e, _) => Padding(padding: const EdgeInsets.all(24), child: Text('$e')),
        data: (items) => Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Padding(
              padding: EdgeInsets.all(12),
              child: Text('Statutory deductions',
                  style: TextStyle(fontWeight: FontWeight.bold)),
            ),
            for (final d in items)
              ListTile(
                dense: true,
                title: Text(d.typeCode),
                trailing: Text(
                    '${d.ratePct.toStringAsFixed(2)}% · ₹${d.amount.toStringAsFixed(2)}'),
              ),
          ],
        ),
      ),
    );
  }
}
