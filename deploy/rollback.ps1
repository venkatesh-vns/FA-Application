# Goes back to the previous version of an environment.
#   deploy\rollback.ps1 -Env production
#   deploy\rollback.ps1 -Env production -RestoreDatabase "<backup file>"   (also puts the database back)
param(
  [Parameter(Mandatory)][ValidateSet('staging', 'production')][string]$Env,
  [string]$RestoreDatabase
)
. "$PSScriptRoot\common.ps1"
$e = Get-Env $Env
if (-not (Test-Path $e.Previous)) { throw "There is no previous version of $($e.Label) to go back to." }
$prev = (Get-Content (Join-Path $e.Previous 'version.json') -Raw | ConvertFrom-Json).version
$cur = if (Test-Path (Join-Path $e.App 'version.json')) { (Get-Content (Join-Path $e.App 'version.json') -Raw | ConvertFrom-Json).version } else { '?' }
Write-Host "Rolling $($e.Label) back from $cur to $prev" -ForegroundColor White
$answer = Read-Host 'Type ROLLBACK to continue'
if ($answer -ne 'ROLLBACK') { Write-Host 'Cancelled.'; exit 1 }

Stop-AppEnv $e
$failed = Join-Path $e.Dir "rolled_back_$cur"
if (Test-Path $failed) { Remove-Item $failed -Recurse -Force }
if (Test-Path $e.App) { Rename-Item $e.App $failed }
Rename-Item $e.Previous $e.App
Write-Ok "Version $prev is installed again (version $cur kept in $failed)."
if ($RestoreDatabase) {
  Invoke-DeployTool @('restore', '--env', $e.ConfigFile, '--file', $RestoreDatabase) | Out-Null
  Write-Ok "Database restored from $RestoreDatabase."
}
Start-AppEnv $e
Invoke-DeployTool @('record', '--env', $e.ConfigFile, '--version', $prev, '--environment', $Env, '--status', 'deployed',
  '--by', "$env:USERNAME on $env:COMPUTERNAME", '--backup', "$RestoreDatabase", '--notes', "Rollback from $cur") | Out-Null
