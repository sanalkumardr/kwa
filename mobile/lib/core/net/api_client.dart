import 'package:dio/dio.dart';

/// Thin wrapper over the NestJS backend. Holds the bearer token and exposes the
/// two sync primitives plus photo upload. Network errors propagate to the
/// SyncEngine, which decides whether to retry — the client itself stays dumb.
class ApiClient {
  ApiClient({
    required String baseUrl,
    required this.tokenProvider,
    this.onUnauthorized,
  }) : _dio = Dio(BaseOptions(
          baseUrl: baseUrl,
          connectTimeout: const Duration(seconds: 10),
          receiveTimeout: const Duration(seconds: 20),
        )) {
    _dio.interceptors.add(InterceptorsWrapper(
      onRequest: (options, handler) {
        final t = tokenProvider();
        if (t != null) options.headers['Authorization'] = 'Bearer $t';
        handler.next(options);
      },
      onError: (e, handler) {
        // Token expired or invalid → force re-login.
        if (e.response?.statusCode == 401) onUnauthorized?.call();
        handler.next(e);
      },
    ));
  }

  final Dio _dio;

  /// Returns the current JWT (or null when logged out).
  final String? Function() tokenProvider;

  /// Called when the server rejects the token (HTTP 401).
  final void Function()? onUnauthorized;

  /// The authenticated user's profile (for role-gating the UI).
  Future<Map<String, Object?>> me() async {
    final res = await _dio.get<Map<String, Object?>>('/auth/me');
    return res.data!;
  }

  Future<List<Map<String, Object?>>> getMilestones(String projectId) =>
      _getList('/milestones', {'projectId': projectId});

  Future<List<Map<String, Object?>>> getMbEntries(String milestoneId) =>
      _getList('/mb-entries', {'milestoneId': milestoneId});

  Future<Map<String, Object?>> createMbEntry(Map<String, Object?> body) async {
    final res = await _dio.post<Map<String, Object?>>('/mb-entries', data: body);
    return res.data!;
  }

  Future<Map<String, Object?>> checkMb(String id) async {
    final res = await _dio.post<Map<String, Object?>>('/mb-entries/$id/check');
    return res.data!;
  }

  Future<Map<String, Object?>> approveMb(String id) async {
    final res = await _dio.post<Map<String, Object?>>('/mb-entries/$id/approve');
    return res.data!;
  }

  Future<List<Map<String, Object?>>> getBills(String projectId) =>
      _getList('/bills', {'projectId': projectId});

  Future<List<Map<String, Object?>>> getRollup([String? orgUnitId]) =>
      _getList('/reports/rollup', orgUnitId != null ? {'orgUnitId': orgUnitId} : null);

  Future<List<Map<String, Object?>>> getQualityTests(String projectId) =>
      _getList('/quality-tests', {'projectId': projectId});

  Future<Map<String, Object?>> createQualityTest(Map<String, Object?> body) async {
    final res = await _dio.post<Map<String, Object?>>('/quality-tests', data: body);
    return res.data!;
  }

  Future<List<Map<String, Object?>>> getDocuments(String projectId) =>
      _getList('/documents', {'projectId': projectId});

  Future<List<Map<String, Object?>>> getExpiringDocuments(
    String projectId, {
    int withinDays = 30,
  }) =>
      _getList('/documents/expiring',
          {'projectId': projectId, 'withinDays': '$withinDays'});

  Future<Map<String, Object?>> createDocument(Map<String, Object?> body) async {
    final res = await _dio.post<Map<String, Object?>>('/documents', data: body);
    return res.data!;
  }

  Future<List<Map<String, Object?>>> getIssues(String projectId) =>
      _getList('/issues', {'projectId': projectId});

  Future<Map<String, Object?>> createIssue(Map<String, Object?> body) async {
    final res = await _dio.post<Map<String, Object?>>('/issues', data: body);
    return res.data!;
  }

  Future<Map<String, Object?>> setIssueStatus(String id, String status) async {
    final res = await _dio.patch<Map<String, Object?>>(
      '/issues/$id/status',
      data: {'status': status},
    );
    return res.data!;
  }

  Future<Map<String, Object?>> computeBill(String id) async {
    final res = await _dio.post<Map<String, Object?>>('/bills/$id/compute');
    return res.data!;
  }

  Future<Map<String, Object?>> certifyBill(String id) async {
    final res = await _dio.post<Map<String, Object?>>('/bills/$id/certify');
    return res.data!;
  }

  Future<List<Map<String, Object?>>> getDeductions(String billId) =>
      _getList('/bills/$billId/deductions', null);

  Future<List<Map<String, Object?>>> _getList(
    String path,
    Map<String, Object?>? query,
  ) async {
    final res =
        await _dio.get<List<dynamic>>(path, queryParameters: query);
    return (res.data ?? const [])
        .cast<Map<String, Object?>>()
        .toList(growable: false);
  }

  /// Request a login OTP for a phone (public endpoint, no token needed).
  Future<Map<String, Object?>> requestOtp(String phone) async {
    final res = await _dio.post<Map<String, Object?>>(
      '/auth/request-otp',
      data: {'phone': phone},
    );
    return res.data ?? const {};
  }

  /// Verify an OTP; returns { token, userId } on success.
  Future<Map<String, Object?>> verifyOtp(String phone, String code) async {
    final res = await _dio.post<Map<String, Object?>>(
      '/auth/verify-otp',
      data: {'phone': phone, 'code': code},
    );
    return res.data!;
  }

  /// Push a single DPR upsert. Server applies its own conflict policy
  /// (operational entity => last-write-wins by updated_at) and echoes the
  /// authoritative row back.
  Future<Map<String, Object?>> pushDpr(Map<String, Object?> json) async {
    final res = await _dio.post<Map<String, Object?>>('/sync/dpr', data: json);
    return res.data!;
  }

  /// Pull all DPRs changed since [since] (server updated_at watermark).
  /// `since == null` means a full initial pull.
  Future<List<Map<String, Object?>>> pullDpr(DateTime? since) async {
    final res = await _dio.get<List<dynamic>>(
      '/sync/dpr',
      queryParameters: {if (since != null) 'since': since.toUtc().toIso8601String()},
    );
    return (res.data ?? const [])
        .cast<Map<String, Object?>>()
        .toList(growable: false);
  }

  /// Pipeline segments for a project (each includes a GeoJSON `geojson` field).
  Future<List<Map<String, Object?>>> getSegments(String projectId) async {
    final res = await _dio.get<List<dynamic>>(
      '/pipelines/segments',
      queryParameters: {'projectId': projectId},
    );
    return (res.data ?? const [])
        .cast<Map<String, Object?>>()
        .toList(growable: false);
  }

  /// Planned vs actual progress: { plannedKm, actualKm, physicalPercent }.
  Future<Map<String, Object?>> getProgress(String projectId) async {
    final res = await _dio.get<Map<String, Object?>>(
      '/pipelines/progress',
      queryParameters: {'projectId': projectId},
    );
    return res.data ?? const {};
  }

  /// Map a GPS fix to chainage on the nearest reach.
  Future<Map<String, Object?>?> locateChainage(
    String projectId,
    double lng,
    double lat,
  ) async {
    final res = await _dio.get<Map<String, Object?>?>(
      '/pipelines/locate',
      queryParameters: {'projectId': projectId, 'lng': lng, 'lat': lat},
    );
    return res.data;
  }

  /// Upload one photo's bytes; returns the server object key to store on the row.
  Future<String> uploadPhoto({
    required String entity,
    required String entityId,
    required String filePath,
  }) async {
    final form = FormData.fromMap({
      'entity': entity,
      'entityId': entityId,
      'file': await MultipartFile.fromFile(filePath),
    });
    final res = await _dio.post<Map<String, Object?>>('/uploads', data: form);
    return res.data!['key'] as String;
  }
}
