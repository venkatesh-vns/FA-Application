# Installs FA Management on a NEW server from the server kit, in one step.
#
#   install-new-server.bat                       (asks for the values)
#   powershell -ExecutionPolicy Bypass -File deploy\install-new-server.ps1 `
#       -DbHost localhost -DbPort 5432 -DbName fa_management -DbUser fa_app `
#       [-RestoreBackup D:\kit\fa_management_xxx.backup] [-InstallRoot C:\FA] [-Port 3100] `
#       [-WithStaging] [-Autostart] [-OpenFirewall]
#
# Before: Node.js 22 and PostgreSQL installed; database setup-database.sql run (database kit).
# Steps:  checks -> settings (config.env with a new JWT_SECRET) -> database connection ->
#         [restore the backup with the existing data] -> install the application ->
#         database tables / changes -> first Admin (empty database only) -> start -> health check.
param(
  [string]$DbHost = 'localhost',
  [int]$DbPort = 5432,
  [string]$DbName = 'fa_management',
  [string]$DbUser = 'fa_app',
  [string]$DbPassword,
  [string]$RestoreBackup,                    # bring the existing data (production backup from the database kit)
  [string]$InstallRoot = 'C:\FA',
  [int]$Port = 3100,
  [string]$TimeZone = 'Asia/Kolkata',
  [switch]$WithStaging,                      # also prepare Staging / UAT (port 3300, fa_management_staging)
  [switch]$Autostart,                        # start with Windows (needs Administrator)
  [switch]$OpenFirewall                      # allow office PCs on the port (needs Administrator)
)
$ErrorActionPreference = 'Stop'
$Kit = Split-Path -Parent $PSScriptRoot
function Step($t) { Write-Host ''; Write-Host "==> $t" -ForegroundColor Cyan }
function Ok($t) { Write-Host "    $t" -ForegroundColor Green }
function Warn($t) { Write-Host "    $t" -ForegroundColor Yellow }

# ---------- 1. checks
Step 'Checking this server'
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { throw 'Node.js is not installed. Install Node.js 22 LTS (https://nodejs.org) for all users, then run this again.' }
$nodeVersion = (& $node.Source -v).TrimStart('v')
if ([version]$nodeVersion -lt [version]'18.0.0') { throw "Node.js $nodeVersion is too old; install Node.js 22 LTS." }
Ok "Node.js $nodeVersion"
$release = Get-ChildItem (Join-Path $Kit 'releases') -Directory | Where-Object { $_.Name -match '^\d+\.\d+\.\d+$' } |
  Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1
if (-not $release) { throw 'No release package in the kit (releases\<version>\app).' }
$Version = $release.Name
Ok "Application version $Version"
$pgDump = $null
foreach ($p in @("$env:ProgramFiles\PostgreSQL")) {
  if (Test-Path $p) { $pgDump = Get-ChildItem $p -Recurse -Filter pg_dump.exe -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1 }
}
if (-not $pgDump) { $pgDump = Get-Command pg_dump -ErrorAction SilentlyContinue }
if ($pgDump) { Ok "PostgreSQL tools: $(if ($pgDump.FullName) { $pgDump.FullName } else { $pgDump.Source })" }
else { Warn 'PostgreSQL tools (pg_dump) not found: backups by the application will not work. Install PostgreSQL "Command Line Tools" on this server.' }
if ($RestoreBackup -and -not $pgDump) { throw 'Restoring a backup needs the PostgreSQL tools (pg_restore). Install them first.' }

if (-not $DbPassword) {
  $sec = Read-Host "Password of database login '$DbUser'" -AsSecureString
  $DbPassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
}

# ---------- 2. environments + settings
Step 'Writing the settings'
$envFile = Join-Path $PSScriptRoot 'environments.json'
$cfg = Get-Content $envFile -Raw | ConvertFrom-Json
$cfg.root = Join-Path $InstallRoot 'environments'
$cfg.production.port = $Port
$cfg.production.db = $DbName
($cfg | ConvertTo-Json -Depth 5) | Set-Content $envFile -Encoding ascii
. "$PSScriptRoot\common.ps1"
$e = Get-Env 'production'
New-Item -ItemType Directory -Force -Path $e.Dir, $e.Backups, $e.Logs, $e.Run | Out-Null
$pgDumpPath = if ($pgDump) { if ($pgDump.FullName) { $pgDump.FullName } else { $pgDump.Source } } else { '' }
$settings = @(
  '# Production settings - written by install-new-server; edit and run deploy\env.ps1 -Env production -Action restart',
  'APP_ENV=production', 'NODE_ENV=production', "PORT=$Port", "CLIENT_URL=http://localhost:$Port",
  "CLIENT_BUILD_DIR=$(Join-Path $e.App 'client\build')",
  "DB_HOST=$DbHost", "DB_PORT=$DbPort", "DB_NAME=$DbName", "DB_USER=$DbUser", "DB_PASSWORD=$DbPassword", 'DB_SSL=false',
  "JWT_SECRET=$(New-JwtSecret)", "APP_TIME_ZONE=$TimeZone",
  'SESSION_IDLE_MINUTES=30', 'SESSION_SECONDS=43200',
  "BACKUP_DIR=$($e.Backups)", "PG_DUMP_PATH=$pgDumpPath"
)
if (Test-Path $e.ConfigFile) { Copy-Item $e.ConfigFile "$($e.ConfigFile).before_install" -Force; Warn 'Existing settings kept as config.env.before_install' }
Set-Content -Path $e.ConfigFile -Value $settings -Encoding ascii
Ok $e.ConfigFile

# ---------- 3. database
Step "Connecting to $DbName on ${DbHost}:$DbPort"
$db = Invoke-DeployTool @('ping', '--env', $e.ConfigFile)
Ok "Connected: PostgreSQL $($db.server), database $($db.database), $($db.records) FA record(s), $($db.users) user(s)."
if ($RestoreBackup) {
  if (-not (Test-Path $RestoreBackup)) { throw "Backup file not found: $RestoreBackup" }
  if ($db.records -gt 0) { throw "$DbName already holds $($db.records) FA records. Restore only into a new, empty database (or restore by hand: Backup & Restore Guide)." }
  Step "Restoring the existing data from $(Split-Path -Leaf $RestoreBackup)"
  Invoke-DeployTool @('restore', '--env', $e.ConfigFile, '--file', $RestoreBackup) | Out-Null
  Invoke-DeployTool @('reset-sessions', '--env', $e.ConfigFile) | Out-Null   # sign-ins of the old server end
  $db = Invoke-DeployTool @('ping', '--env', $e.ConfigFile)
  Ok "Restored: $($db.records) FA record(s), $($db.users) user(s)."
}

# ---------- 4. application
Step "Installing the application (version $Version) in $($e.App)"
if (Get-AppInfo $e) { Stop-AppEnv $e }
if (Test-Path $e.App) {
  if (Test-Path $e.Previous) { Remove-Item $e.Previous -Recurse -Force }
  Rename-Item $e.App $e.Previous
}
robocopy (Join-Path $release.FullName 'app') $e.App /E /NFL /NDL /NJH /NJS /NP | Out-Null
Copy-Item $e.ConfigFile (Join-Path $e.App 'server\.env') -Force
Ok 'Installed.'

Step 'Database tables and changes'
Push-Location (Join-Path $e.App 'server')
$mig = & $node.Source scripts\migrate.js 2>&1
$code = $LASTEXITCODE
$mig | ForEach-Object { Write-Host "    $_" }
if ($code -ne 0) { Pop-Location; throw 'Creating / updating the database tables failed (see above). Check that the login owns the database (setup-database.sql).' }
if ($db.users -eq 0) {
  & $node.Source scripts\seedAdmin.js | ForEach-Object { Write-Host "    $_" }
  Warn 'First Admin: admin / admin123 - sign in and change the password at once (Settings).'
}
Pop-Location

# ---------- 5. start
Step 'Starting'
Start-AppEnv $e
$info = Get-AppInfo $e
if (-not $info -or $info.version -ne $Version) { throw "Health check failed (running: '$($info.version)')." }
Invoke-DeployTool @('record', '--env', $e.ConfigFile, '--version', $Version, '--environment', 'production', '--status', 'deployed',
  '--by', "$env:USERNAME on $env:COMPUTERNAME", '--notes', 'New server installation') | Out-Null
Ok "Health check passed: version $($info.version)."

if ($WithStaging) {
  Step 'Preparing Staging / UAT (deploy a version there with deploy\deploy.bat staging <version>)'
  $s = Get-Env 'staging'
  New-Item -ItemType Directory -Force -Path $s.Dir, $s.Backups, $s.Logs, $s.Run | Out-Null
  $stage = $settings -replace '^APP_ENV=production$', 'APP_ENV=staging' -replace "^PORT=$Port$", "PORT=$($s.Port)" `
    -replace "^CLIENT_URL=.*", "CLIENT_URL=http://localhost:$($s.Port)" -replace '^CLIENT_BUILD_DIR=.*', "CLIENT_BUILD_DIR=$(Join-Path $s.App 'client\build')" `
    -replace "^DB_NAME=.*", "DB_NAME=$($s.Db)" -replace '^BACKUP_DIR=.*', "BACKUP_DIR=$($s.Backups)" -replace '^JWT_SECRET=.*', "JWT_SECRET=$(New-JwtSecret)" `
    -replace '^# Production', '# Staging / UAT'
  Set-Content -Path $s.ConfigFile -Value $stage -Encoding ascii
  Ok "$($s.ConfigFile) (database $($s.Db), port $($s.Port))"
}
if ($Autostart) { & "$PSScriptRoot\install-autostart.ps1" -Env production }
if ($OpenFirewall) {
  netsh advfirewall firewall add rule name="FA Management ($Port)" dir=in action=allow protocol=TCP localport=$Port | Out-Null
  Ok "Firewall: port $Port open for office PCs."
}

Write-Host ''
Write-Host "FA Management $Version is installed and running: http://localhost:$Port  (office PCs: http://$env:COMPUTERNAME`:$Port)" -ForegroundColor Green
Write-Host "Settings: $($e.ConfigFile)   Logs: $($e.Logs)" -ForegroundColor Green
