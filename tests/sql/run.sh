#!/usr/bin/env bash
# Loads a schema-only dump of the live database into a scratch local database, adds two test firms,
# and runs the isolation checks. Usage: tests/sql/run.sh path/to/schema.sql [database] [psql options...]
set -u
DUMP="${1:?Give the schema dump file, e.g. tests/sql/run.sh ~/duesk-schema.sql}"
DB="${2:-duesk_test}"
shift $(( $# >= 2 ? 2 : 1 ))
HERE="$(cd "$(dirname "$0")" && pwd)"
PSQL=(psql "$@")

"${PSQL[@]}" -d postgres -qAt -c "drop database if exists $DB" -c "create database $DB" || exit 1
"${PSQL[@]}" -d "$DB" -q -f "$HERE/00_supabase_stubs.sql" || exit 1
# A Supabase dump has a few lines a plain Postgres can't run (the public schema already exists, newer privileges); they don't matter here
"${PSQL[@]}" -d "$DB" -q -f "$DUMP" 2>&1 | grep "ERROR" | grep -v "already exists\|maintain"
"${PSQL[@]}" -d "$DB" -q -v ON_ERROR_STOP=1 -f "$HERE/01_two_firms.sql" || exit 1
"${PSQL[@]}" -d "$DB" -qAt -v ON_ERROR_STOP=1 -f "$HERE/10_isolation.sql"
