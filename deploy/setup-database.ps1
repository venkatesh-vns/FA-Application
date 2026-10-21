# Prepares the database server for FA Management, and optionally restores the data.
#
#   powershell -ExecutionPolicy Bypass -File deploy\setup-database.ps1 `
#       [-DbHost localhost] [-DbPort 5432] [-AdminUser postgres] [-AppUser fa_app] [-DbName fa_management] `
#       [-RestoreBackup D:\kit\fa_management_xxx.backup]
#
# Passwords: FA_PG_ADMIN_PASSWORD (PostgreSQL superuser) and FA_DB_PASSWORD (the application's
# login) from the environment (set by the setup EXEs), otherwise asked for.
# Steps:  the application login (created if missing, CREATEDB) -> databases <DbName>, <DbName>_staging,
#         <DbName>_archive owned by it (created if missing) -> [restore the backup into <DbName>,
#         only when it is empty; then nobody is signed in].
# Uses psql / pg_restore of the newest PostgreSQL in Program Files (no Node.js needed).
param(
  [string]$DbHost = 'localhost',
  [int]$DbPort = 5432,
  [string]$AdminUser = 'postgres',
  [string]$AppUser = 'fa_app',
  [string]$DbName = 'fa_management',
  [string]$RestoreBackup,
  [switch]$SkipCreate                        # login and databases exist already (only restore)
)
$ErrorActionPreference = 'Stop'
function Step($t) { Write-Host ''; Write-Host "==> $t" -ForegroundColor Cyan }
function Ok($t) { Write-Host "    $t" -ForegroundColor Green }
function Ask([string]$prompt) {
  $sec = Read-Host $prompt -AsSecureString
  [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
}
foreach ($n in $AppUser, $DbName, $AdminUser) {
  if ($n -notmatch '^[a-z_][a-z0-9_]*$') { throw "'$n' is not a valid name (lower-case letters, digits and _ only)." }
}

Step 'PostgreSQL tools'
$bin = @($env:ProgramW6432, $env:ProgramFiles) | Where-Object { $_ } | Select-Object -Unique |   # 64-bit too, from a 32-bit setup
  ForEach-Object { Get-ChildItem (Join-Path $_ 'PostgreSQL') -Directory -ErrorAction SilentlyContinue } |
  Where-Object { Test-Path (Join-Path $_.FullName 'bin\psql.exe') } |
  Sort-Object { [double]($_.Name -replace '[^0-9.]', '') } -Descending | Select-Object -First 1 |
  ForEach-Object { Join-Path $_.FullName 'bin' }
if (-not $bin) {
  $p = Get-Command psql -ErrorAction SilentlyContinue
  if ($p) { $bin = Split-Path -Parent $p.Source }
}
if (-not $bin) { throw 'PostgreSQL is not installed here (psql.exe not found). Install PostgreSQL 16+ (or its Command Line Tools) first.' }
$psql = Join-Path $bin 'psql.exe'
$pgRestore = Join-Path $bin 'pg_restore.exe'
Ok $bin

$appPassword = $env:FA_DB_PASSWORD
if (-not $appPassword) { $appPassword = Ask "Password of the application login '$AppUser'" }
$env:FA_DB_PASSWORD = $null

# psql as a login; returns the output lines, throws with psql's message on failure
function Invoke-Psql([string]$User, [string]$Password, [string]$Db, [string]$Sql, [switch]$File) {
  $env:PGPASSWORD = $Password
  $env:PGCONNECT_TIMEOUT = '10'
  try {
    $a = @('-h', $DbHost, '-p', $DbPort, '-U', $User, '-d', $Db, '-w', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1')
    $a += if ($File) { @('-f', $Sql) } else { @('-c', $Sql) }
    $ErrorActionPreference = 'Continue'      # psql's messages on stderr are not a failure by themselves
    $out = & $psql @a 2>&1
    $ErrorActionPreference = 'Stop'
    if ($LASTEXITCODE -ne 0) { throw (($out | ForEach-Object { "$_" }) -join "`n").Trim() }
    $out | ForEach-Object { "$_" } | Where-Object { $_ -ne '' }
  } finally { $env:PGPASSWORD = $null }
}
function Test-AppLogin([string]$Db) {
  try { Invoke-Psql $AppUser $appPassword $Db 'select 1' | Out-Null; $true } catch { $false }
}

if (-not $SkipCreate) {
  Step "Login and databases on ${DbHost}:$DbPort"
  $adminPassword = $env:FA_PG_ADMIN_PASSWORD
  if (-not $adminPassword) { $adminPassword = Ask "Password of the PostgreSQL superuser '$AdminUser'" }
  $env:FA_PG_ADMIN_PASSWORD = $null
  try { $ver = Invoke-Psql $AdminUser $adminPassword 'postgres' 'show server_version' }
  catch { throw "Cannot sign in to PostgreSQL as '$AdminUser' on ${DbHost}:${DbPort}: $($_.Exception.Message)" }
  Ok "PostgreSQL $ver"

  $roleExists = (Invoke-Psql $AdminUser $adminPassword 'postgres' "select count(*) from pg_roles where rolname = '$AppUser'") -eq '1'
  if ($roleExists) {
    if (-not (Test-AppLogin 'postgres')) {
      throw "The login '$AppUser' exists already with a different password. Enter its current password (or change it in pgAdmin first)."
    }
    Ok "Login '$AppUser' exists (password checked)."
  } else {
    # the password goes through a temporary file, never on a command line
    $tmp = [IO.Path]::GetTempFileName()
    try {
      $quoted = $appPassword -replace "'", "''"
      Set-Content -Path $tmp -Value "CREATE ROLE $AppUser LOGIN CREATEDB PASSWORD '$quoted';" -Encoding UTF8
      Invoke-Psql $AdminUser $adminPassword 'postgres' $tmp -File | Out-Null
    } finally { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }
    Ok "Login '$AppUser' created."
  }
  foreach ($db in $DbName, "${DbName}_staging", "${DbName}_archive") {
    $exists = (Invoke-Psql $AdminUser $adminPassword 'postgres' "select count(*) from pg_database where datname = '$db'") -eq '1'
    if ($exists) { Ok "Database $db exists." }
    else {
      Invoke-Psql $AdminUser $adminPassword 'postgres' "CREATE DATABASE $db OWNER $AppUser ENCODING 'UTF8' TEMPLATE template0" | Out-Null
      Ok "Database $db created (owner $AppUser)."
    }
  }
  # fast "contains" search for an empty database (a restore brings it, owned by the login)
  if (-not $RestoreBackup) {
    try { Invoke-Psql $AdminUser $adminPassword $DbName 'CREATE EXTENSION IF NOT EXISTS pg_trgm' | Out-Null } catch { }
  }
} elseif (-not (Test-AppLogin $DbName)) {
  throw "Cannot sign in to $DbName as '$AppUser' on ${DbHost}:$DbPort (check the password and pg_hba.conf)."
}

if ($RestoreBackup) {
  if (-not (Test-Path $RestoreBackup)) { throw "Backup file not found: $RestoreBackup" }
  Step "Restoring $(Split-Path -Leaf $RestoreBackup) into $DbName"
  $tables = [int](Invoke-Psql $AppUser $appPassword $DbName "select count(*) from information_schema.tables where table_schema = 'public'")
  if ($tables -gt 0) {
    $records = try { Invoke-Psql $AppUser $appPassword $DbName 'select count(*) from fa_records' } catch { '?' }
    throw "$DbName is not empty ($tables tables, $records FA records). The data is restored only into a new, empty database, so nothing was changed."
  }
  $env:PGPASSWORD = $appPassword
  $ErrorActionPreference = 'Continue'        # pg_restore reports on stderr; judged below
  try {
    # as the application login, so it owns every restored table
    $out = & $pgRestore -h $DbHost -p $DbPort -U $AppUser -w -d $DbName --no-owner --no-privileges $RestoreBackup 2>&1
    $code = $LASTEXITCODE
  } finally { $env:PGPASSWORD = $null; $ErrorActionPreference = 'Stop' }
  $errors = $out | ForEach-Object { "$_" } | Where-Object { $_ -match 'error' -and $_ -notmatch 'extension|COMMENT ON' }
  if ($code -ne 0 -and $errors) { throw "Restore failed:`n$(($errors | Select-Object -First 10) -join "`n")" }
  # sign-ins and reservations of the old server end
  Invoke-Psql $AppUser $appPassword $DbName 'DELETE FROM sessions' | Out-Null
  try { Invoke-Psql $AppUser $appPassword $DbName 'DELETE FROM qty_locks' | Out-Null } catch { }
  $records = Invoke-Psql $AppUser $appPassword $DbName 'select count(*) from fa_records'
  $users = Invoke-Psql $AppUser $appPassword $DbName 'select count(*) from users'
  Ok "Restored: $records FA record(s), $users user(s). Everybody signs in again."
}

Write-Host ''
Write-Host "Database ready: $DbName on ${DbHost}:$DbPort, login $AppUser." -ForegroundColor Green
exit 0
