# Nightly backup of an environment's database, keeping the last N days.
#   deploy\backup-nightly.ps1 -Env production [-KeepDays 30]
#   deploy\backup-nightly.ps1 -Env production -Install     (Administrator: every night at 01:30)
param(
  [Parameter(Mandatory)][ValidateSet('staging', 'production')][string]$Env,
  [int]$KeepDays = 30,
  [switch]$Install
)
. "$PSScriptRoot\common.ps1"
$e = Get-Env $Env
if ($Install) {
  $nodeDir = Split-Path -Parent (Get-Node)
  $command = "`$env:Path = '$nodeDir;' + `$env:Path; & '$PSCommandPath' -Env $Env -KeepDays $KeepDays"
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -Command `"$command`""
  $trigger = New-ScheduledTaskTrigger -Daily -At '01:30'
  Register-ScheduledTask -TaskName "FA Management - nightly backup ($Env)" -Action $action -Trigger $trigger -User 'SYSTEM' -RunLevel Highest -Force | Out-Null
  Write-Ok "Nightly backup installed (01:30, keeps $KeepDays days) in $($e.Backups)."
  exit 0
}
$r = Invoke-DeployTool @('backup', '--env', $e.ConfigFile, '--name', 'nightly')
Write-Ok "Backup: $($r.file) ($([math]::Round($r.bytes / 1MB, 1)) MB)"
Get-ChildItem $e.Backups -Filter '*_nightly_*.backup' | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$KeepDays) } | ForEach-Object {
  Remove-Item $_.FullName -Force
  Write-Ok "Removed old backup $($_.Name)"
}
