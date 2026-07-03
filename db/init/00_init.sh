#!/usr/bin/env bash
# Runs once, as the Postgres superuser, on first container init.
# Creates the application role and databases, and installs the extensions the
# migrations need (postgis/pgcrypto require superuser, so they're created here).
#
# kwa_app is intentionally NOT a superuser and does NOT have BYPASSRLS: it owns
# the kwa/kwa_test databases, so when migration 002 sets FORCE ROW LEVEL
# SECURITY the policies bind to it. This is what makes RLS real at runtime.
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<-'EOSQL'
  CREATE ROLE kwa_app LOGIN PASSWORD 'kwa_app';
  CREATE DATABASE kwa      OWNER kwa_app;
  CREATE DATABASE kwa_test OWNER kwa_app;
EOSQL

for db in kwa kwa_test; do
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$db" <<-'EOSQL'
    CREATE EXTENSION IF NOT EXISTS postgis;
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
    GRANT ALL ON SCHEMA public TO kwa_app;
EOSQL
done

echo "init: kwa_app role + kwa/kwa_test databases + extensions ready"
