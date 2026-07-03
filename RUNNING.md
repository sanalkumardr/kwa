# Running KWA Pipeline Works locally

A Docker harness that brings up Postgres+PostGIS, applies the migrations, and
runs the API — so you can exercise the full stack and the test suite for real.

## Prerequisites

- Docker + Docker Compose
- Node 20+ (only if you want to run the integration tests or the token helper on the host)

## 1. Bring up the stack

```bash
docker compose up --build
```

This starts three things in order:

1. **db** — Postgres 16 + PostGIS. On first boot, `db/init/00_init.sh` (running
   as superuser) creates the non-superuser **`kwa_app`** role and the `kwa` and
   `kwa_test` databases, and installs the `postgis`/`pgcrypto` extensions.
2. **migrate** — applies migrations `001/002/003` to `kwa` **as `kwa_app`**, so
   every object is owned by a non-superuser and `FORCE ROW LEVEL SECURITY`
   actually binds. Skips if the schema already exists.
3. **api** — the NestJS server on http://localhost:3000, connected as `kwa_app`.

> Why `kwa_app` and not the superuser: Postgres exempts superusers (and
> `BYPASSRLS` roles) from RLS even when forced. Connecting the app as an
> ordinary owner is what makes the row-level security guarantees real.

To wipe and start clean (drops the data volume):

```bash
docker compose down -v && docker compose up --build
```

## 2. Hit the API

The seed (migration 003) gives you EE Menon and a project that already has a
certified bill. Mint a token and call the API:

```bash
cd backend && npm install            # once, for the helper + jsonwebtoken
TOKEN=$(node scripts/make-token.js)  # defaults to EE Menon + dev secret

curl -s localhost:3000/projects -H "Authorization: Bearer $TOKEN" | jq

# the seeded, certified bill — gross 1881000, net 1692900
BILL=55555555-3333-0000-0000-000000000001
curl -s localhost:3000/bills/$BILL/deductions -H "Authorization: Bearer $TOKEN" | jq
```

RLS in action — a token for a user in another division returns a different
(or empty) project list from the same endpoint.

## 3. Run the integration tests

The DB is published on `localhost:5432`, and `kwa_test` is owned by `kwa_app`,
so the suite runs from the host against the containerized database:

```bash
cd backend
npm install
TEST_DATABASE_URL=postgres://kwa_app:kwa_app@localhost:5432/kwa_test npm test
```

The suite resets the `kwa` schema in `kwa_test` and proves RLS isolation, sync
scoping, MB/bill immutability, the certified→paid exception, and `compute_bill`
correctness.

## 4. Point the mobile app at the API

In `mobile/`:

```bash
flutter pub get
flutter run --dart-define=KWA_API_BASE_URL=http://10.0.2.2:3000   # Android emulator
```

Sign in with phone-OTP on first launch (the dev server echoes the code, so the
login screen pre-fills it); the token is persisted, so later launches skip
login. Then follow the Phase 0 acceptance steps in `mobile/README.md`.

## Layout

```
docker-compose.yml      db + migrate + api
db/init/00_init.sh      superuser bootstrap (roles, dbs, extensions)
db/run_migrations.sh    applies 001/002/003 as kwa_app
backend/Dockerfile      builds the NestJS API
migrations/             the SQL applied by the migrate service
backend/, mobile/       API and Flutter app
```
