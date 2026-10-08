#!/usr/bin/env bash
# Runs supabase/tests/*.sql against DATABASE_URL. Each file wraps itself in
# begin … rollback; a failed assertion raises and aborts the file.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
: "${DATABASE_URL:?DATABASE_URL is required (local Supabase: postgresql://postgres:postgres@127.0.0.1:54322/postgres)}"
status=0
for f in "$ROOT"/supabase/tests/*.sql; do
  if out=$(psql "$DATABASE_URL" -qX -v ON_ERROR_STOP=1 -f "$f" 2>&1); then
    echo "✓ $(basename "$f")"
  else
    echo "✗ $(basename "$f")"; echo "$out" | sed 's/^/    /'; status=1
  fi
done
exit $status
