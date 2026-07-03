import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/auth_controller.dart';
import 'core/providers.dart';
import 'features/auth/login_screen.dart';
import 'features/dpr/dpr_list_screen.dart';

void main() {
  runApp(const ProviderScope(child: KwaApp()));
}

class KwaApp extends ConsumerWidget {
  const KwaApp({super.key});

  // Demo project id (matches migration 003 seed). Replace with real selection.
  static const _demoProjectId = '55555555-0000-0000-0000-000000000001';

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final db = ref.watch(localDbProvider);
    final auth = ref.watch(authProvider);
    return MaterialApp(
      title: 'KWA Pipeline Works',
      theme: ThemeData(useMaterial3: true, colorSchemeSeed: Colors.teal),
      home: db.when(
        loading: () =>
            const Scaffold(body: Center(child: CircularProgressIndicator())),
        error: (e, _) => Scaffold(body: Center(child: Text('DB error: $e'))),
        data: (_) => auth.when(
          loading: () =>
              const Scaffold(body: Center(child: CircularProgressIndicator())),
          error: (e, _) => Scaffold(body: Center(child: Text('Auth error: $e'))),
          data: (token) => token == null
              ? const LoginScreen()
              : const DprListScreen(projectId: _demoProjectId),
        ),
      ),
    );
  }
}
