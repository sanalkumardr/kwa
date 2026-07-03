import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Holds the auth token, persisted in the platform keystore/keychain so the
/// user stays signed in across app restarts. `build()` loads it on startup;
/// `login`/`logout` write through to secure storage.
class AuthNotifier extends AsyncNotifier<String?> {
  static const _storage = FlutterSecureStorage();
  static const _key = 'kwa_jwt';

  @override
  Future<String?> build() => _storage.read(key: _key);

  Future<void> login(String token) async {
    await _storage.write(key: _key, value: token);
    state = AsyncData(token);
  }

  Future<void> logout() async {
    await _storage.delete(key: _key);
    state = const AsyncData(null);
  }
}

final authProvider =
    AsyncNotifierProvider<AuthNotifier, String?>(AuthNotifier.new);
