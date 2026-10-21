# One-time setup of an environment folder and its settings (config.env).
#   deploy\setup-environment.ps1 -Env staging
# The database login is taken from server\.env of the source; review config.env afterwards.
param([Parameter(Mandatory)][ValidateSet('staging', 'production')][string]$Env)
. "$PSScriptRoot\common.ps1"
$e = Get-Env $Env

Write-Step "Setting up $($e.Label) in $($e.Dir)"
New-Item -ItemType Directory -Force -Path $e.Dir, $e.Backups, $e.Logs, $e.Run | Out-Null
if (Test-Path $e.ConfigFile) { Write-Ok "Settings already exist: $($e.ConfigFile) (left unchanged)"; exit 0 }

$src = Join-Path $Source 'server\.env'
if (-not (Test-Path $src)) { throw "server\.env not found; create it from server\.env.example first." }
$keep = 'DB_USER', 'DB_PASSWORD', 'DB_HOST', 'DB_PORT', 'APP_TIME_ZONE', 'SESSION_IDLE_MINUTES', 'SESSION_SECONDS', 'PG_DUMP_PATH'
$lines = Get-Content $src | Where-Object { $_ -match '^\s*([A-Z_]+)\s*=' -and $keep -contains $Matches[1] }
$settings = @(
  "# $($e.Label) settings - used by every deployment of this environment",
  "APP_ENV=$Env",
  "NODE_ENV=production",
  "PORT=$($e.Port)",
  "CLIENT_URL=http://localhost:$($e.Port)",
  "CLIENT_BUILD_DIR=$(Join-Path $e.App 'client\build')",
  "DB_NAME=$($e.Db)",
  "BACKUP_DIR=$($e.Backups)"
) + $lines
Set-Content -Path $e.ConfigFile -Value $settings -Encoding ascii
Write-Ok "Settings written: $($e.ConfigFile)"
Write-Ok "Database: $($e.Db)   Port: $($e.Port)"
