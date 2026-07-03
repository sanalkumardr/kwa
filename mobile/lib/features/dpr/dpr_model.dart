import 'dart:convert';

/// A Daily Progress Report. Plain immutable model; (de)serializes to both the
/// local SQLite row and the server JSON. `synced` is local-only bookkeeping.
class Dpr {
  const Dpr({
    required this.id,
    required this.projectId,
    required this.reportDate,
    this.weather,
    this.lengthLaidTodayM,
    this.chainageReached,
    this.workDone,
    this.workPlanned,
    this.blockers,
    this.status = 'draft',
    this.lat,
    this.lng,
    this.chainage,
    required this.updatedAt,
    this.deleted = false,
    this.synced = false,
  });

  final String id;
  final String projectId;
  final String reportDate; // YYYY-MM-DD
  final String? weather;
  final double? lengthLaidTodayM;
  final double? chainageReached;
  final String? workDone;
  final String? workPlanned;
  final String? blockers;
  final String status;
  final double? lat;
  final double? lng;
  final double? chainage;
  final DateTime updatedAt;
  final bool deleted;
  final bool synced;

  Dpr copyWith({
    String? status,
    String? workDone,
    String? workPlanned,
    String? blockers,
    double? lengthLaidTodayM,
    double? chainageReached,
    double? lat,
    double? lng,
    double? chainage,
    DateTime? updatedAt,
    bool? deleted,
    bool? synced,
  }) {
    return Dpr(
      id: id,
      projectId: projectId,
      reportDate: reportDate,
      weather: weather,
      lengthLaidTodayM: lengthLaidTodayM ?? this.lengthLaidTodayM,
      chainageReached: chainageReached ?? this.chainageReached,
      workDone: workDone ?? this.workDone,
      workPlanned: workPlanned ?? this.workPlanned,
      blockers: blockers ?? this.blockers,
      status: status ?? this.status,
      lat: lat ?? this.lat,
      lng: lng ?? this.lng,
      chainage: chainage ?? this.chainage,
      updatedAt: updatedAt ?? this.updatedAt,
      deleted: deleted ?? this.deleted,
      synced: synced ?? this.synced,
    );
  }

  Map<String, Object?> toRow() => {
        'id': id,
        'project_id': projectId,
        'report_date': reportDate,
        'weather': weather,
        'length_laid_today_m': lengthLaidTodayM,
        'chainage_reached': chainageReached,
        'work_done': workDone,
        'work_planned': workPlanned,
        'blockers': blockers,
        'status': status,
        'lat': lat,
        'lng': lng,
        'chainage': chainage,
        'updated_at': updatedAt.toUtc().toIso8601String(),
        'deleted': deleted ? 1 : 0,
        'synced': synced ? 1 : 0,
      };

  factory Dpr.fromRow(Map<String, Object?> r) => Dpr(
        id: r['id'] as String,
        projectId: r['project_id'] as String,
        reportDate: r['report_date'] as String,
        weather: r['weather'] as String?,
        lengthLaidTodayM: (r['length_laid_today_m'] as num?)?.toDouble(),
        chainageReached: (r['chainage_reached'] as num?)?.toDouble(),
        workDone: r['work_done'] as String?,
        workPlanned: r['work_planned'] as String?,
        blockers: r['blockers'] as String?,
        status: r['status'] as String,
        lat: (r['lat'] as num?)?.toDouble(),
        lng: (r['lng'] as num?)?.toDouble(),
        chainage: (r['chainage'] as num?)?.toDouble(),
        updatedAt: DateTime.parse(r['updated_at'] as String),
        deleted: (r['deleted'] as int) == 1,
        synced: (r['synced'] as int) == 1,
      );

  /// Server JSON (no local-only `synced` flag).
  Map<String, Object?> toServerJson() => {
        'id': id,
        'projectId': projectId,
        'reportDate': reportDate,
        'weather': weather,
        'lengthLaidTodayM': lengthLaidTodayM,
        'chainageReached': chainageReached,
        'workDone': workDone,
        'workPlanned': workPlanned,
        'blockers': blockers,
        'status': status,
        'lat': lat,
        'lng': lng,
        'updatedAt': updatedAt.toUtc().toIso8601String(),
        'deleted': deleted,
      };

  factory Dpr.fromServerJson(Map<String, Object?> j) => Dpr(
        id: j['id'] as String,
        projectId: j['projectId'] as String,
        reportDate: j['reportDate'] as String,
        weather: j['weather'] as String?,
        lengthLaidTodayM: (j['lengthLaidTodayM'] as num?)?.toDouble(),
        chainageReached: (j['chainageReached'] as num?)?.toDouble(),
        workDone: j['workDone'] as String?,
        workPlanned: j['workPlanned'] as String?,
        blockers: j['blockers'] as String?,
        status: (j['status'] as String?) ?? 'draft',
        lat: (j['lat'] as num?)?.toDouble(),
        lng: (j['lng'] as num?)?.toDouble(),
        chainage: (j['chainage'] as num?)?.toDouble(),
        updatedAt: DateTime.parse(j['updatedAt'] as String),
        deleted: (j['deleted'] as bool?) ?? false,
        synced: true, // anything from the server is, by definition, synced
      );

  String encodePayload() => jsonEncode(toServerJson());
}
