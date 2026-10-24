# Keeps the FA Management server available: no sleep, and everything starts by itself after a restart.
#
#   Configure-Server.bat                          (right-click > Run as administrator; asks the questions)
#   powershell -ExecutionPolicy Bypass -File configure-server.ps1 [-AppFolder C:\FA] [-ActiveHours 7-23] [-CheckOnly]
#
#   1. Power      High performance plan; never sleep / hibernate / turn off the disk; Fast Startup
#                 off; closing a laptop lid or pressing the sleep button does nothing; network
#                 adapters stay powered. (The screen may still turn off - that does not matter.)
#   2. PostgreSQL its service starts automatically with Windows and restarts itself after a failure.
#   3. Application starts with Windows and is checked every 5 minutes (Task Scheduler, as SYSTEM):
#                 if it stopped, it is started again.
#   4. Windows Update (only with -ActiveHours): no automatic restart during working hours
#                 and none while someone is signed in.
#   -CheckOnly    only shows the current state; changes nothing (no administrator needed).
param(
  [string]$AppFolder,                       # where FA Management is installed (found by itself if empty)
  [string]$ActiveHours,                     # e.g. 7-23 (start-end, at most 18 hours)
  [switch]$CheckOnly
)
$ErrorActionPreference = 'Stop'
function Step($t) { Write-Host ''; Write-Host "==> $t" -ForegroundColor Cyan }
function Ok($t) { Write-Host "    $t" -ForegroundColor Green }
function Bad($t) { Write-Host "    $t" -ForegroundColor Yellow }
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $CheckOnly -and -not $isAdmin) { throw 'Run this as administrator (right-click Configure-Server.bat > Run as administrator).' }

# ---------- where the application is
if (-not $AppFolder) {
  $reg = Get-ItemProperty 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\FA-Management' -ErrorAction SilentlyContinue
  $AppFolder = if ($reg.InstallLocation) { $reg.InstallLocation } else { 'C:\FA' }
}
$deploy = @("$AppFolder\kit\deploy", "$AppFolder\deploy", (Join-Path $PSScriptRoot 'deploy'), $PSScriptRoot) |
  Where-Object { Test-Path (Join-Path $_ 'install-autostart.ps1') } | Select-Object -First 1

# ---------- 1. power
Step 'Power settings (sleep)'
function Get-AcSeconds([string]$sub, [string]$setting) {
  $q = powercfg /q SCHEME_CURRENT $sub $setting 2>$null | Select-String 'Current AC Power Setting Index: (0x[0-9a-f]+)'
  if ($q) { [Convert]::ToInt32($q.Matches[0].Groups[1].Value, 16) } else { $null }
}
if (-not $CheckOnly) {
  powercfg /setactive SCHEME_MIN | Out-Null                       # High performance
  foreach ($t in 'standby-timeout', 'hibernate-timeout', 'disk-timeout') {
    powercfg /change "$t-ac" 0 | Out-Null
    powercfg /change "$t-dc" 0 | Out-Null
  }
  powercfg /hibernate off 2>$null | Out-Null                      # also turns Fast Startup off
  foreach ($a in @('SUB_BUTTONS LIDACTION', 'SUB_BUTTONS SBUTTONACTION', 'SUB_SLEEP HYBRIDSLEEP', 'SUB_SLEEP RTCWAKE')) {
    $sub, $set = $a -split ' '
    $value = if ($set -eq 'RTCWAKE') { 1 } else { 0 }              # lid / sleep button: do nothing; wake timers allowed
    powercfg /setacvalueindex SCHEME_CURRENT $sub $set $value 2>$null | Out-Null
    powercfg /setdcvalueindex SCHEME_CURRENT $sub $set $value 2>$null | Out-Null
  }
  powercfg /setactive SCHEME_CURRENT | Out-Null
  Set-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Power' -Name HiberbootEnabled -Value 0 -Type DWord
  try {
    Get-NetAdapter -Physical | Where-Object Status -ne 'Disabled' | ForEach-Object {
      Disable-NetAdapterPowerManagement -Name $_.Name -NoRestart -ErrorAction SilentlyContinue
    }
  } catch { }
}
$plan = (powercfg /getactivescheme) -replace '^.*\((.*)\).*$', '$1'
$sleep = Get-AcSeconds 'SUB_SLEEP' 'STANDBYIDLE'
$hib = Get-AcSeconds 'SUB_SLEEP' 'HIBERNATEIDLE'
$disk = Get-AcSeconds 'SUB_DISK' 'DISKIDLE'
$fast = (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Power' -ErrorAction SilentlyContinue).HiberbootEnabled
Ok "Power plan: $plan"
function Span([int]$s) { if ($s -ge 60) { "$([math]::Round($s / 60)) minutes" } else { "$s seconds" } }
if ($sleep -eq 0) { Ok 'Sleep: never' } else { Bad "Sleep after $(Span $sleep) - the application becomes unreachable then." }
if ($hib -eq 0 -or $null -eq $hib) { Ok 'Hibernate: never' } else { Bad "Hibernate after $(Span $hib)" }
if ($disk -eq 0) { Ok 'Turn off hard disk: never' } else { Bad "Hard disk turns off after $(Span $disk) idle" }
if ($fast -eq 1) { Bad 'Fast Startup is on (a shutdown is really a hibernation; start-up tasks may not run).' } else { Ok 'Fast Startup: off' }
try {
  Get-NetAdapter -Physical | Where-Object Status -eq 'Up' | ForEach-Object {
    $pm = Get-NetAdapterPowerManagement -Name $_.Name -ErrorAction SilentlyContinue
    if ($pm -and "$($pm.AllowComputerToTurnOffDevice)" -match 'Enabled') { Bad "Network '$($_.Name)': Windows may turn it off to save power" }
    else { Ok "Network '$($_.Name)': stays on" }
  }
} catch { }

# ---------- 2. PostgreSQL
Step 'PostgreSQL service'
$services = @(Get-Service -Name 'postgresql*' -ErrorAction SilentlyContinue)
if (-not $services) { Bad 'No PostgreSQL service on this server (database on another server? then configure that server too).' }
foreach ($s in $services) {
  if (-not $CheckOnly) {
    Set-Service -Name $s.Name -StartupType Automatic
    sc.exe failure $s.Name reset= 86400 actions= restart/60000/restart/60000/restart/120000 | Out-Null
    if ($s.Status -ne 'Running') { Start-Service $s.Name }
  }
  $s = Get-Service $s.Name
  $line = "$($s.Name): start $($s.StartType), $($s.Status)"
  if ($s.StartType -eq 'Automatic' -and $s.Status -eq 'Running') { Ok $line } else { Bad $line }
  if ((sc.exe qfailure $s.Name | Out-String) -match 'RESTART') { Ok 'Restarts itself after a failure' }
  else { Bad 'Not restarted automatically after a failure' }
}

# ---------- 3. application
Step 'FA Management application'
if (-not $deploy) { Bad "FA Management not found in $AppFolder (use -AppFolder <install folder>)." }
else {
  $tasks = @(Get-ScheduledTask -TaskName 'FA Management - *' -ErrorAction SilentlyContinue)
  if (-not $CheckOnly -and -not ($tasks | Where-Object TaskName -match 'Production')) {
    & (Join-Path $deploy 'install-autostart.ps1') -Env production
    $tasks = @(Get-ScheduledTask -TaskName 'FA Management - *' -ErrorAction SilentlyContinue)
  }
  if (-not $tasks) { Bad 'Does NOT start with Windows (no scheduled task).' }
  foreach ($t in $tasks) {
    if (-not $CheckOnly -and $t.State -eq 'Disabled') { Enable-ScheduledTask -TaskName $t.TaskName | Out-Null; $t = Get-ScheduledTask -TaskName $t.TaskName }
    $info = Get-ScheduledTaskInfo -TaskName $t.TaskName
    $msg = "'$($t.TaskName)': $($t.State); last check $($info.LastRunTime)"
    if ($t.State -ne 'Disabled') { Ok "$msg - starts with Windows, checked every 5 minutes" } else { Bad $msg }
  }
  $cfg = Get-Content (Join-Path $deploy 'environments.json') -Raw | ConvertFrom-Json
  try {
    $h = Invoke-RestMethod "http://localhost:$($cfg.production.port)/api/health" -TimeoutSec 5
    Ok "Running now: version $($h.version), database $($h.database) - http://localhost:$($cfg.production.port)"
  } catch { Bad "Not answering on port $($cfg.production.port) right now (the 5-minute check starts it)." }
}

# ---------- 4. Windows Update
Step 'Windows Update restarts'
$au = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU'
$ux = 'HKLM:\SOFTWARE\Microsoft\WindowsUpdate\UX\Settings'
if ($ActiveHours -and -not $CheckOnly) {
  if ($ActiveHours -notmatch '^(\d{1,2})-(\d{1,2})$') { throw 'ActiveHours as start-end, e.g. 7-23.' }
  $start = [int]$Matches[1]; $end = [int]$Matches[2]
  if ($start -gt 23 -or $end -gt 23 -or (($end - $start + 24) % 24) -gt 18) { throw 'ActiveHours: hours 0-23, at most 18 hours apart.' }
  New-Item -Path $au -Force | Out-Null
  Set-ItemProperty $au -Name NoAutoRebootWithLoggedOnUsers -Value 1 -Type DWord
  New-Item -Path $ux -Force | Out-Null
  Set-ItemProperty $ux -Name ActiveHoursStart -Value $start -Type DWord
  Set-ItemProperty $ux -Name ActiveHoursEnd -Value $end -Type DWord
}
$a = Get-ItemProperty $ux -ErrorAction SilentlyContinue
$n = (Get-ItemProperty $au -ErrorAction SilentlyContinue).NoAutoRebootWithLoggedOnUsers
if ($null -ne $a.ActiveHoursStart) { Ok "Active hours (no update restarts): $($a.ActiveHoursStart):00 - $($a.ActiveHoursEnd):00" } else { Bad 'Active hours not set: Windows may restart for updates at any time.' }
if ($n -eq 1) { Ok 'No automatic update restart while someone is signed in' }

Write-Host ''
if ($CheckOnly) { Write-Host 'Check only - nothing was changed.' -ForegroundColor Green }
else { Write-Host 'Done. The server stays awake, and PostgreSQL and FA Management start by themselves after a restart.' -ForegroundColor Green }
exit 0
