# KWA Pipeline Works — Mobile (Phase 0: Offline Sync Slice)

A deliberately narrow Flutter app that proves the **hardest, riskiest** part of the project before any GIS is built: an offline-first sync engine and photo-upload queue, exercised on a single entity (DPR). Per the spec, sync is where these projects fail — so this gets validated first.

## Phase 0 scope (and non-scope)

In: local-first writes, an ordered outbox, watermarked pull, server-wins conflict resolution, a retrying photo queue, and reconnect-triggered sync.
Out (on purpose): maps/chainage/PostGIS, the MB/bill/approval workflows, real auth/OTP. Those come in later phases once sync is trusted.

## Architecture

```
UI (Riverpod)
   │  write
   ▼
DprRepository ──► local SQLite row  +  outbox row   (one transaction, no network)
   │                                   │
   │ read (always local)               ▼
   │                            SyncEngine.sync()
   │                              1. PUSH outbox (in order)
   │                              2. PULL since watermark (server-wins)
   │                              3. drain PhotoUploadQueue (backoff retry)
   ▲                                   ▲
   └─────────── live stream ───────────┘
Connectivity change ─► triggers sync() on reconnect
```

### Why these choices
- **sqflite, not Drift/Isar** — no `build_runner` codegen step, so the project compiles straight after `flutter pub get`. The sync logic is storage-agnostic; swapping in Drift later is mechanical.
- **Client-generated UUIDs** — rows get their permanent id offline, so there's no "temp id → server id" reconciliation.
- **Outbox pattern** — every write appends an ordered mutation. Push is idempotent and resumable: a crash mid-sync just leaves rows to retry. Per-id ordering is preserved (a row's later edit never overtakes an earlier one).
- **Poison-row quarantine** — a payload the server *permanently* rejects (4xx, excluding 408/429) is quarantined rather than retried forever, so one bad record can't wedge the whole queue. It's kept with its error for inspection; other ids keep syncing. The three phases (push / pull / photos) run independently, so a transient push failure still lets pull and the photo queue make progress.
- **Server-wins by `updated_at`, but never clobber un-pushed local edits** — correct for an operational entity like DPR. The engine documents that financial/legal entities (MB, bills) must instead be append-only/lock-after-approval — matching the database guarantees — which is exactly why Phase 0 stays DPR-only.

## Files

```
lib/
  core/
    db/local_db.dart            sqflite schema: dpr, outbox, photo_queue, sync_state
    net/api_client.dart         dio wrapper: pushDpr / pullDpr / uploadPhoto
    sync/sync_engine.dart       push → pull → photos; conflict + watermark logic
    sync/photo_upload_queue.dart  retrying binary uploads (exp. backoff)
    providers.dart              Riverpod wiring + reconnect trigger
  features/auth/
    login_screen.dart           phone-OTP sign-in (sets the auth token)
  features/dpr/
    dpr_model.dart              entity (row + server JSON)
    dpr_repository.dart         offline-first write/read
    dpr_providers.dart          live list stream
    dpr_list_screen.dart        status banner + list + create + manual sync
  features/pipeline/            Phase 1 GIS layer (read-only map)
    pipeline_models.dart        segment (GeoJSON→LatLng) + progress
    pipeline_providers.dart     segments + progress fetch
    pipeline_map_screen.dart    flutter_map route, coloured by status
  features/workflow/            Phase 2 review + approval (online)
    workflow_models.dart        Me, Milestone, MbEntry, Bill, Deduction
    workflow_providers.dart     role + list providers
    milestones_screen.dart      milestones → MB entries
    mb_entries_screen.dart      MB list with AE check / AEE approve
    bills_screen.dart           bills: compute, certify, deductions sheet
    dashboard_screen.dart       division rollup (physical + financial)
    issues_screen.dart          raise GPS-pinned issues, resolve
    quality_screen.dart         record/list QC tests
    documents_screen.dart       drawings/permits, capture+register, expiry
  main.dart
```

## Phase 2 — review & approval (online)

From the DPR app bar's workflow menu: **Milestones & MB** drills into a
milestone's Measurement Book entries, and **Bills** lists running bills. Actions
are role-gated by `/auth/me`: an AE sees **Check** on measured entries, an
AEE/EE sees **Approve** on checked entries (which locks them server-side) and
**Certify** on draft bills; **Compute** pulls approved MB and applies the
deduction rules. Tapping a bill shows its itemised statutory deductions.
**Division rollup** is the leadership dashboard: every project in scope with a
physical-progress bar, certified-vs-paid money (lakh/crore formatted), and an
open-issues badge, from `/reports/rollup`.

These are online review/approval flows — the offline write path stays DPR
(Phase 0). The client only gates the UI; the database remains the real
authority (workflow order, locking, RLS scope are all enforced server-side).

## Phase 1 — route map (read-only)

The map screen (open it from the map icon on the DPR list) renders each route
reach as a polyline coloured by status (grey=planned, orange=in progress,
green=laid, blue=tested) over OSM tiles, with a planned-vs-actual header. It
consumes the backend chainage endpoints (`/pipelines/segments`, `/progress`).

GIS is **reference data**: pulled when online and shown read-only. The offline
write path remains DPR (Phase 0) — consistent with the sync contract, where
financial/legal and reference entities are never authored offline on-device.

## Auth & GPS

Login is phone-OTP (`features/auth/login_screen.dart`): the app calls
`/auth/request-otp` then `/auth/verify-otp` and hands the JWT to the
`authProvider` (`core/auth_controller.dart`), which persists it in the platform
keystore/keychain via `flutter_secure_storage` — so the user stays signed in
across restarts. The token is attached to every request; on an HTTP 401 the API
client clears it and the app returns to the login screen. A sign-out action is
in the DPR app bar.

Creating a DPR captures a best-effort GPS fix (geolocator) and sends `lat/lng`
in the sync payload. The server projects it onto the route and returns the
**chainage** (km), which the list shows as `ch X.XXX km`. Location is never
blocking — if permission is denied the report is still created, just untagged.

Creating a DPR also offers to capture a **site photo** (image_picker → camera).
The file is queued in `PhotoUploadQueue` and uploaded to the server's storage
(local disk or S3) under `dpr/<id>/…` when connectivity allows, retrying with
backoff — never blocking the report. (Linking the returned object key back onto
`dpr.photos` is a follow-up; for now the photo is associated by `entityId` in
storage.)

Add the platform permissions before running on a device:
`ACCESS_FINE_LOCATION` + `CAMERA` (Android `AndroidManifest.xml`), and
`NSLocationWhenInUseUsageDescription` + `NSCameraUsageDescription`
(iOS `Info.plist`).

## Run

```bash
flutter pub get
flutter run --dart-define=KWA_API_BASE_URL=http://10.0.2.2:3000   # Android emulator → host
```

Seed an auth token for testing by setting `authTokenProvider` (after real OTP login it's set automatically). The demo project id in `main.dart` matches migration `003_seed_demo.sql`.

## Server contract this slice expects (Phase 0 backend work)

The existing NestJS DPR endpoints are workflow-oriented (`create`/`submit`/`approve`). Sync needs two extra **delta** endpoints plus an upload endpoint. Add these to the backend:

| Method | Path | Body / Query | Returns |
|---|---|---|---|
| POST | `/sync/dpr` | DPR JSON (incl. `id`, `updatedAt`) | authoritative DPR row (after server-wins merge) |
| GET  | `/sync/dpr` | `?since=<ISO8601>` | array of DPRs with `updatedAt > since` |
| POST | `/uploads` | multipart: `entity`, `entityId`, `file` | `{ "key": "<object-key>", "url": "<download-url>" }` |

Server-side rules: `POST /sync/dpr` upserts by `id`, applying last-write-wins by `updatedAt`; `GET /sync/dpr` returns soft-deleted rows too (so deletes propagate) and is RLS-scoped to the caller. These run through the same `withUser` transaction as the rest of the API.

## How to prove Phase 0 works (acceptance test)

1. Airplane mode on. Create several DPRs → they appear instantly, marked unsynced (orange).
2. Kill and reopen the app → data persists (local SQLite).
3. Airplane mode off → banner shows pushing, rows flip to synced (green) without user action.
4. Edit the same DPR on a second device while offline on the first; reconnect both → newer `updatedAt` wins, no crash, no lost outbox rows.
5. Queue a photo offline → it uploads on reconnect; force failures → it retries with backoff and never blocks DPR sync.
