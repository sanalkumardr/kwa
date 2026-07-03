import 'dart:convert';

import 'package:latlong2/latlong.dart';

/// A route reach with its polyline (decoded from server GeoJSON) and status.
class PipelineSegment {
  const PipelineSegment({
    required this.id,
    required this.name,
    required this.chainageFrom,
    required this.chainageTo,
    required this.status,
    required this.points,
  });

  final String id;
  final String? name;
  final double? chainageFrom;
  final double? chainageTo;
  final String status; // planned | in_progress | laid | tested
  final List<LatLng> points;

  factory PipelineSegment.fromServerJson(Map<String, Object?> j) {
    return PipelineSegment(
      id: j['id'] as String,
      name: j['name'] as String?,
      chainageFrom: (j['chainage_from'] as num?)?.toDouble(),
      chainageTo: (j['chainage_to'] as num?)?.toDouble(),
      status: (j['status'] as String?) ?? 'planned',
      points: _decodeLineString(j['geojson'] as String?),
    );
  }

  /// GeoJSON LineString → LatLng list. Coordinates are [lng, lat(, z)].
  static List<LatLng> _decodeLineString(String? geojson) {
    if (geojson == null) return const [];
    final obj = jsonDecode(geojson) as Map<String, Object?>;
    if (obj['type'] != 'LineString') return const [];
    final coords = (obj['coordinates'] as List<dynamic>).cast<List<dynamic>>();
    return coords
        .map((c) => LatLng((c[1] as num).toDouble(), (c[0] as num).toDouble()))
        .toList(growable: false);
  }
}

/// Physical progress summary for a project.
class PipelineProgress {
  const PipelineProgress({
    required this.plannedKm,
    required this.actualKm,
    required this.physicalPercent,
  });

  final double plannedKm;
  final double actualKm;
  final double physicalPercent;

  factory PipelineProgress.fromServerJson(Map<String, Object?> j) {
    return PipelineProgress(
      plannedKm: (j['plannedKm'] as num?)?.toDouble() ?? 0,
      actualKm: (j['actualKm'] as num?)?.toDouble() ?? 0,
      physicalPercent: (j['physicalPercent'] as num?)?.toDouble() ?? 0,
    );
  }
}
