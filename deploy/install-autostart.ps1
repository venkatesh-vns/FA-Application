# Starts an environment automatically when Windows starts (Task Scheduler, no
# extra software), and restarts it every 5 minutes if it stopped.
#   deploy\install-autostart.ps1 -Env production            (run as Administrator)
#   deploy\install-autostart.ps1 -Env production -Remove
param(
  [Parameter(Mandatory)][ValidateSet('staging', 'production')][string]$Env,
  [switch]$Remove
)
. "$PSScriptRoot\common.ps1"
$e = Get-Env $Env
$name = "FA Management - $($e.Label)"
if ($Remove) {
  Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
  Write-Ok "Automatic start removed: $name"
  exit 0
}
$nodeDir = Split-Path -Parent (Get-Node)
$script = Join-Path $PSScriptRoot 'env.ps1'
# node's folder is put on PATH for the SYSTEM account, which may not have it
$command = "`$env:Path = '$nodeDir;' + `$env:Path; & '$script' -Env $Env -Action start"
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -Command `"$command`""
$triggers = @(
  (New-ScheduledTaskTrigger -AtStartup),
  (New-ScheduledTaskTrigger -Once -At (Get-Date).Date -RepetitionInterval (New-TimeSpan -Minutes 5))
)
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
Register-ScheduledTask -TaskName $name -Action $action -Trigger $triggers -Settings $settings -User 'SYSTEM' -RunLevel Highest -Force | Out-Null
Write-Ok "Automatic start installed: '$name' (at Windows start, and checked every 5 minutes)."
Write-Ok 'Starting a running environment again does nothing, so the 5-minute check is safe.'
