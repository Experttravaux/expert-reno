#!/usr/bin/env bash
# Rebuild a throw-away database on a bare Postgres (with PostGIS) and run the
# SQL test-suite. Usage: PGURL=postgres://postgres:postgres@localhost:5432 ./bare-postgres.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
PGURL="${PGURL:-postgres://postgres:postgres@localhost:5432}"
DB="${THIQA_TEST_DB:-thiqa_test}"

psql "$PGURL/postgres" -qX -v ON_ERROR_STOP=1 -c "drop database if exists $DB with (force)" -c "create database $DB"
psql "$PGURL/postgres" -qX -v ON_ERROR_STOP=1 -c "alter database $DB set search_path = public, extensions"
URL="$PGURL/$DB"
run() { psql "$URL" -qX -v ON_ERROR_STOP=1 "$@"; }

run -f "$ROOT/packages/db/scripts/supabase-shim.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "→ $(basename "$f")"
  run -f "$f"
done
echo "→ seed.sql";      run -f "$ROOT/supabase/seed.sql"
echo "→ seed.dev.sql";  run -f "$ROOT/supabase/seed.dev.sql"
DATABASE_URL="$URL" "$ROOT/packages/db/scripts/test-sql.sh"
