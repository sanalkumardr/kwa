import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../../core/providers.dart';
import 'workflow_models.dart';
import 'workflow_providers.dart';

/// Drawings, permits and agreements for a project. Lists documents (permits
/// expiring within 30 days are flagged) and registers a new one by capturing a
/// photo, uploading it, then linking the returned storage key.
class DocumentsScreen extends ConsumerWidget {
  const DocumentsScreen({super.key, required this.projectId});
  final String projectId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final docs = ref.watch(documentsProvider(projectId));
    return Scaffold(
      appBar: AppBar(title: const Text('Documents')),
      floatingActionButton: FloatingActionButton.extended(
        icon: const Icon(Icons.upload_file_outlined),
        label: const Text('Add'),
        onPressed: () => _add(context, ref),
      ),
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(documentsProvider(projectId)),
        child: docs.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (e, _) => ListView(children: [Center(child: Text('Error: $e'))]),
          data: (items) => items.isEmpty
              ? const Center(child: Text('No documents.'))
              : ListView.separated(
                  itemCount: items.length,
                  separatorBuilder: (_, __) => const Divider(height: 1),
                  itemBuilder: (_, i) => _DocTile(doc: items[i]),
                ),
        ),
      ),
    );
  }

  Future<void> _add(BuildContext context, WidgetRef ref) async {
    String kind = 'drawing';
    DateTime? expiry;
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Add document'),
        content: StatefulBuilder(
          builder: (_, setState) => Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              DropdownButtonFormField<String>(
                value: kind,
                decoration: const InputDecoration(labelText: 'Kind'),
                items: const [
                  DropdownMenuItem(value: 'drawing', child: Text('Drawing')),
                  DropdownMenuItem(value: 'permit', child: Text('Permit')),
                  DropdownMenuItem(value: 'agreement', child: Text('Agreement')),
                  DropdownMenuItem(value: 'noc', child: Text('NOC')),
                ],
                onChanged: (v) => setState(() => kind = v ?? 'drawing'),
              ),
              if (kind == 'permit' || kind == 'noc')
                TextButton.icon(
                  icon: const Icon(Icons.event),
                  label: Text(expiry == null
                      ? 'Set expiry date'
                      : 'Expires ${expiry!.toIso8601String().substring(0, 10)}'),
                  onPressed: () async {
                    final d = await showDatePicker(
                      context: ctx,
                      firstDate: DateTime.now(),
                      lastDate: DateTime.now().add(const Duration(days: 3650)),
                      initialDate: DateTime.now().add(const Duration(days: 90)),
                    );
                    if (d != null) setState(() => expiry = d);
                  },
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
              child: const Text('Capture & save')),
        ],
      ),
    );
    if (ok != true) return;

    final x = await ImagePicker().pickImage(source: ImageSource.camera);
    if (x == null) return;

    final api = ref.read(apiClientProvider);
    // upload the file, then register the document with the returned key
    final up = await api.uploadPhoto(
        entity: 'document', entityId: projectId, filePath: x.path);
    await api.createDocument({
      'projectId': projectId,
      'kind': kind,
      'storageKey': up,
      if (expiry != null) 'expiresOn': expiry!.toIso8601String().substring(0, 10),
    });
    ref.invalidate(documentsProvider(projectId));
  }
}

class _DocTile extends StatelessWidget {
  const _DocTile({required this.doc});
  final Document doc;

  @override
  Widget build(BuildContext context) {
    final expiringSoon = doc.expiresOn != null &&
        DateTime.tryParse(doc.expiresOn!) != null &&
        DateTime.parse(doc.expiresOn!)
            .isBefore(DateTime.now().add(const Duration(days: 30)));
    return ListTile(
      leading: Icon(switch (doc.kind) {
        'permit' => Icons.verified_outlined,
        'agreement' => Icons.description_outlined,
        'noc' => Icons.assignment_turned_in_outlined,
        _ => Icons.architecture_outlined,
      }),
      title: Text('${doc.kind ?? "doc"} · v${doc.version}'),
      subtitle: doc.expiresOn != null ? Text('expires ${doc.expiresOn}') : null,
      trailing: expiringSoon
          ? const Chip(
              label: Text('expiring', style: TextStyle(fontSize: 11)),
              backgroundColor: Color(0x33FF9800),
            )
          : null,
    );
  }
}
