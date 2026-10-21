# Start / stop / status of an installed environment.
#   deploy\env.ps1 -Env production -Action start
param(
  [Parameter(Mandatory)][ValidateSet('staging', 'production')][string]$Env,
  [Parameter(Mandatory)][ValidateSet('start', 'stop', 'restart', 'status')][string]$Action
)
. "$PSScriptRoot\common.ps1"
$e = Get-Env $Env
switch ($Action) {
  'start' { Start-AppEnv $e }
  'stop' { Stop-AppEnv $e }
  'restart' { Stop-AppEnv $e; Start-AppEnv $e }
  'status' {
    $info = Get-AppInfo $e
    if ($info) { Write-Ok "$($e.Label): running version $($info.version) on http://localhost:$($e.Port)" }
    else { Write-Warn2 "$($e.Label): not running (port $($e.Port))." }
  }
}
