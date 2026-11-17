# Loads a schema-only dump of the live database into a scratch local database, adds two test firms,
# and runs the isolation checks. See tests/README.md.
param(
  [Parameter(Mandatory = $true)][string]$Dump,
  [string]$Psql = "psql",
  [string]$Database = "duesk_test",
  [string]$User = "postgres"
)
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

& $Psql -U $User -d postgres -qAt -c "drop database if exists $Database" -c "create database $Database"
if ($LASTEXITCODE -ne 0) { exit 1 }
& $Psql -U $User -d $Database -q -f "$here\00_supabase_stubs.sql"
if ($LASTEXITCODE -ne 0) { exit 1 }
# A Supabase dump has a few lines a plain Postgres can't run (the public schema already exists, newer privileges); they don't matter here
& $Psql -U $User -d $Database -q -f $Dump 2>&1 | Select-String "ERROR" | Where-Object { $_ -notmatch "already exists|maintain" }
& $Psql -U $User -d $Database -q -v ON_ERROR_STOP=1 -f "$here\01_two_firms.sql"
if ($LASTEXITCODE -ne 0) { exit 1 }
& $Psql -U $User -d $Database -qAt -v ON_ERROR_STOP=1 -f "$here\10_isolation.sql"
exit $LASTEXITCODE
