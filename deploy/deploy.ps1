# Deploys a release to an environment.
#   deploy\deploy.ps1 -Env staging    -Version 1.1.0   (refreshes staging with a copy of production first)
#   deploy\deploy.ps1 -Env production -Version 1.1.0   (only after approval on staging)
# Steps: approval check (production), backup, stop, keep the running version
# as 'previous', install, database changes, start, health check, record.
# Any failure after the stop rolls back: previous version again, and the
# database restored from the backup if database changes had been applied.
param(
  [Parameter(Mandatory)][ValidateSet('staging', 'production')][string]$Env,
  [Parameter(Mandatory)][string]$Version,
  [switch]$NoRefresh   # staging: keep the current staging data instead of a fresh copy of production
)
. "$PSScriptRoot\common.ps1"
$e = Get-Env $Env
$pkg = Join-Path $Source "releases\$Version\app"
$by = "$env:USERNAME on $env:COMPUTERNAME"
New-Item -ItemType Directory -Force -Path $e.Logs | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
Start-Transcript -Path (Join-Path $e.Logs "deploy_$($Version)_$stamp.log") | Out-Null
try {
  Write-Host "Deploying version $Version to $($e.Label)" -ForegroundColor White
  if (-not (Test-Path (Join-Path $pkg 'version.json'))) { throw "Release $Version not found. Run deploy\release.bat $Version first." }
  if (-not (Test-Path $e.ConfigFile)) { throw "$($e.Label) is not set up. Run deploy\setup-environment.ps1 -Env $Env first." }
  Update-ConfigFile $e

  if ($Env -eq 'production') {
    Write-Step 'Checking the staging approval'
    $stage = Get-Env 'staging'
    $ok = Invoke-DeployTool @('check-approval', '--env', $stage.ConfigFile, '--version', $Version)
    Write-Ok "Approved by $($ok.by): $($ok.note)"
  }

  if ($Env -eq 'staging' -and -not $NoRefresh) {
    Write-Step 'Refreshing staging with a copy of production data'
    Stop-AppEnv $e
    $r = Invoke-DeployTool @('refresh-staging', '--from', (Get-Env 'production').ConfigFile, '--env', $e.ConfigFile)
    Write-Ok "$($r.refreshed) now holds a copy of $($r.from) ($($r.records) FA records)."
  }

  Write-Step "Backing up the $($e.Label) database"
  $backup = Invoke-DeployTool @('backup', '--env', $e.ConfigFile, '--name', "before_deploy_$Version")
  Write-Ok "$($backup.file) ($([math]::Round($backup.bytes / 1MB, 1)) MB)"
  $before = (Invoke-DeployTool @('migration-count', '--env', $e.ConfigFile)).count
} catch {
  Write-Host "`nDeployment stopped before any change: $($_.Exception.Message)" -ForegroundColor Red
  Stop-Transcript | Out-Null
  exit 1
}

$installed = $false
try {
  Write-Step "Stopping $($e.Label)"
  Stop-AppEnv $e

  Write-Step "Installing version $Version"
  if (Test-Path $e.App) {
    if (Test-Path $e.Previous) { Remove-Item $e.Previous -Recurse -Force }
    Rename-Item $e.App $e.Previous
    Write-Ok "The running version is kept in $($e.Previous) for rollback."
  }
  robocopy $pkg $e.App /E /NFL /NDL /NJH /NJS /NP | Out-Null
  Copy-Item $e.ConfigFile (Join-Path $e.App 'server\.env') -Force
  $installed = $true

  Write-Step 'Applying database changes'
  Push-Location (Join-Path $e.App 'server')
  $mig = & (Get-Node) scripts\migrate.js 2>&1
  $code = $LASTEXITCODE
  Pop-Location
  $mig | ForEach-Object { Write-Host "    $_" }
  if ($code -ne 0) { throw "Database changes failed: $($mig | Out-String)" }
  $applied = ($mig | Where-Object { $_ -match '^Applied ' } | ForEach-Object { $_ -replace '^Applied ', '' }) -join ', '

  Write-Step "Starting $($e.Label)"
  Start-AppEnv $e
  $info = Get-AppInfo $e
  if (-not $info -or $info.version -ne $Version) { throw "Health check failed: the running version is '$($info.version)', expected $Version." }
  Write-Ok "Health check passed: version $($info.version), $($info.environmentLabel)."

  Invoke-DeployTool @('record', '--env', $e.ConfigFile, '--version', $Version, '--environment', $Env, '--status', 'deployed',
    '--by', $by, '--backup', $backup.file, '--migrations', $applied) | Out-Null
  Write-Host ''
  Write-Host "Version $Version is live on $($e.Label): http://localhost:$($e.Port)" -ForegroundColor Green
  if ($Env -eq 'staging') { Write-Host 'Next: users test it, then an Admin approves it in Administration > Releases (on staging).' -ForegroundColor Green }
} catch {
  $reason = $_.Exception.Message
  Write-Host "`nDeployment FAILED: $reason" -ForegroundColor Red
  Write-Step 'Rolling back'
  try {
    Stop-AppEnv $e
    if ($installed -and (Test-Path $e.Previous)) {
      if (Test-Path $e.App) { Remove-Item $e.App -Recurse -Force }
      Rename-Item $e.Previous $e.App
      Write-Ok 'Previous version restored.'
    }
    $after = (Invoke-DeployTool @('migration-count', '--env', $e.ConfigFile)).count
    if ($after -ne $before) {
      Invoke-DeployTool @('restore', '--env', $e.ConfigFile, '--file', $backup.file) | Out-Null
      Write-Ok "Database restored from $($backup.file)."
    }
    if (Test-Path (Join-Path $e.App 'server\server.js')) { Start-AppEnv $e }
    Invoke-DeployTool @('record', '--env', $e.ConfigFile, '--version', $Version, '--environment', $Env, '--status', 'failed',
      '--by', $by, '--backup', $backup.file, '--notes', $reason.Substring(0, [math]::Min(400, $reason.Length))) | Out-Null
  } catch {
    Write-Host "Rollback problem: $($_.Exception.Message). Restore manually: deploy\rollback.ps1 -Env $Env -RestoreDatabase `"$($backup.file)`"" -ForegroundColor Red
  }
  Stop-Transcript | Out-Null
  exit 1
}
Stop-Transcript | Out-Null
