/// Models for the Phase 2 review/approval workflows. All read from the API as
/// camelCase or snake_case JSON depending on the endpoint; helpers normalise.

double? _d(Object? v) => v == null ? null : (v as num).toDouble();
String? _s(Object? v) => v as String?;

class Me {
  const Me({required this.id, required this.name, required this.role});
  final String id;
  final String name;
  final String role; // contractor|overseer|ae|aee|ee|admin
  factory Me.fromJson(Map<String, Object?> j) =>
      Me(id: j['id'] as String, name: j['name'] as String, role: j['role'] as String);
}

class Milestone {
  const Milestone({
    required this.id,
    required this.name,
    this.chainageFrom,
    this.chainageTo,
    this.plannedQty,
    this.unit,
    required this.status,
  });
  final String id;
  final String name;
  final double? chainageFrom;
  final double? chainageTo;
  final double? plannedQty;
  final String? unit;
  final String status;
  factory Milestone.fromJson(Map<String, Object?> j) => Milestone(
        id: j['id'] as String,
        name: j['name'] as String,
        chainageFrom: _d(j['chainage_from']),
        chainageTo: _d(j['chainage_to']),
        plannedQty: _d(j['planned_qty']),
        unit: _s(j['unit']),
        status: j['status'] as String,
      );
}

class MbEntry {
  const MbEntry({
    required this.id,
    this.chainageFrom,
    this.chainageTo,
    required this.quantity,
    this.unit,
    required this.rateSnapshot,
    required this.amount,
    this.checkedBy,
    this.approvedBy,
    required this.locked,
  });
  final String id;
  final double? chainageFrom;
  final double? chainageTo;
  final double quantity;
  final String? unit;
  final double rateSnapshot;
  final double amount;
  final String? checkedBy;
  final String? approvedBy;
  final bool locked;

  /// Workflow state for the UI.
  String get stage => locked
      ? 'approved'
      : checkedBy != null
          ? 'checked'
          : 'measured';

  factory MbEntry.fromJson(Map<String, Object?> j) => MbEntry(
        id: j['id'] as String,
        chainageFrom: _d(j['chainage_from']),
        chainageTo: _d(j['chainage_to']),
        quantity: _d(j['quantity']) ?? 0,
        unit: _s(j['unit']),
        rateSnapshot: _d(j['rate_snapshot']) ?? 0,
        amount: _d(j['amount']) ?? 0,
        checkedBy: _s(j['checked_by']),
        approvedBy: _s(j['approved_by']),
        locked: (j['locked_flag'] as bool?) ?? false,
      );
}

class Bill {
  const Bill({
    required this.id,
    required this.runningBillNo,
    required this.gross,
    required this.deductions,
    required this.net,
    required this.status,
  });
  final String id;
  final int runningBillNo;
  final double gross;
  final double deductions;
  final double net;
  final String status;
  factory Bill.fromJson(Map<String, Object?> j) => Bill(
        id: j['id'] as String,
        runningBillNo: (j['running_bill_no'] as num).toInt(),
        gross: _d(j['gross_amount']) ?? 0,
        deductions: _d(j['total_deductions']) ?? 0,
        net: _d(j['net_payable']) ?? 0,
        status: j['status'] as String,
      );
}

class QualityTest {
  const QualityTest({
    required this.id,
    this.testType,
    this.result,
    this.value,
    this.testedAt,
  });
  final String id;
  final String? testType;
  final String? result; // pass|fail
  final String? value;
  final String? testedAt;
  factory QualityTest.fromJson(Map<String, Object?> j) => QualityTest(
        id: j['id'] as String,
        testType: _s(j['test_type']),
        result: _s(j['result']),
        value: _s(j['value']),
        testedAt: _s(j['tested_at']),
      );
}

class Document {
  const Document({
    required this.id,
    this.kind,
    required this.version,
    required this.storageKey,
    this.expiresOn,
  });
  final String id;
  final String? kind;
  final int version;
  final String storageKey;
  final String? expiresOn;
  factory Document.fromJson(Map<String, Object?> j) => Document(
        id: j['id'] as String,
        kind: _s(j['kind']),
        version: (j['version'] as num?)?.toInt() ?? 1,
        storageKey: j['storage_key'] as String,
        expiresOn: _s(j['expires_on']),
      );
}

class Issue {
  const Issue({
    required this.id,
    required this.title,
    this.priority,
    required this.status,
    this.lat,
    this.lng,
    this.dueDate,
  });
  final String id;
  final String title;
  final String? priority; // low|med|high
  final String status; // open|in_progress|resolved
  final double? lat;
  final double? lng;
  final String? dueDate;
  factory Issue.fromJson(Map<String, Object?> j) => Issue(
        id: j['id'] as String,
        title: j['title'] as String,
        priority: _s(j['priority']),
        status: j['status'] as String,
        lat: _d(j['lat']),
        lng: _d(j['lng']),
        dueDate: _s(j['due_date']),
      );
}

class RollupRow {
  const RollupRow({
    required this.projectId,
    required this.name,
    required this.plannedKm,
    required this.laidKm,
    required this.physicalPercent,
    required this.certifiedNet,
    required this.paid,
    required this.openIssues,
  });
  final String projectId;
  final String name;
  final double plannedKm;
  final double laidKm;
  final double physicalPercent;
  final double certifiedNet;
  final double paid;
  final int openIssues;
  factory RollupRow.fromJson(Map<String, Object?> j) => RollupRow(
        projectId: j['projectId'] as String,
        name: j['name'] as String,
        plannedKm: _d(j['plannedKm']) ?? 0,
        laidKm: _d(j['laidKm']) ?? 0,
        physicalPercent: _d(j['physicalPercent']) ?? 0,
        certifiedNet: _d(j['certifiedNet']) ?? 0,
        paid: _d(j['paid']) ?? 0,
        openIssues: (j['openIssues'] as num?)?.toInt() ?? 0,
      );
}

class Deduction {
  const Deduction({required this.typeCode, required this.ratePct, required this.amount});
  final String typeCode;
  final double ratePct;
  final double amount;
  factory Deduction.fromJson(Map<String, Object?> j) => Deduction(
        typeCode: j['type_code'] as String,
        ratePct: _d(j['rate_pct']) ?? 0,
        amount: _d(j['amount']) ?? 0,
      );
}
