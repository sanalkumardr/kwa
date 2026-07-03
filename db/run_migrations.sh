#!/usr/bin/env bash
# Applies migrations to the kwa database as the kwa_app role.
# Idempotent at the compose level: if the kwa schema already exists, it skips,
# so `docker compose up` again won't wipe your data. To force a clean rebuild,
# `docker compose down -v` (removes the volume) then up.
set -euo pipefail

CONN="-h db -U kwa_app -d kwa"

echo "migrate: waiting for database..."
until pg_isready $CONN >/dev/null 2>&1; do sleep 1; done

exists="$(psql $CONN -tAc \
  "SELECT 1 FROM information_schema.schemata WHERE schema_name = 'kwa'" || true)"

if [ "$exists" = "1" ]; then
  echo "migrate: kwa schema already present — skipping."
  exit 0
fi

for f in 001_schema 002_rls 003_seed_demo 004_chainage 005_auth_dpr_gps; do
  echo "migrate: applying $f.sql"
  psql $CONN -v ON_ERROR_STOP=1 -f "/migrations/$f.sql"
done

echo "migrate: done."
