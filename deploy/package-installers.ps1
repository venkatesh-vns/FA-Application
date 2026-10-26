# Builds the two setup EXEs for a new server from the server kits:
#   deliverables\FA-Management-<version>-Installers\
#     FA-Management-Setup-<version>.exe      application (with Node.js), settings, start, firewall, auto-start
#     FA-Management-Database-<version>.exe   login + databases + restore of the production data (included)
#     fa_management_<version>.backup         the same data, for pgAdmin > Restore
#   deploy\package-installers.ps1 -Version 1.2.0 [-RebuildKits]
# Needs NSIS (makensis): installed in Program Files, or the copy electron-builder keeps in its cache.
param(
  [Parameter(Mandatory)][string]$Version,
  [switch]$RebuildKits,                      # take a fresh production backup first (package-server-kit.ps1)
  [switch]$TestBuild                         # setup EXE without administrator rights (tests on a development PC)
)
. "$PSScriptRoot\common.ps1"
$outRoot = Join-Path $Source 'deliverables'
$appKit = Join-Path $outRoot "FA-Management-$Version-Application-Kit"
$dbKit = Join-Path $outRoot "FA-Management-$Version-Database-Kit"
if ($RebuildKits -or -not (Test-Path $appKit) -or -not (Test-Path $dbKit)) {
  & "$PSScriptRoot\package-server-kit.ps1" -Version $Version
  if ($LASTEXITCODE -ne 0) { throw 'Building the server kits failed.' }
}
$backup = Get-ChildItem $dbKit -Filter *.backup | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $backup) { throw "No .backup in $dbKit (run with -RebuildKits)." }

$makensis = @("${env:ProgramFiles(x86)}\NSIS\makensis.exe", "$env:ProgramFiles\NSIS\makensis.exe") +
  @(Get-ChildItem "$env:LOCALAPPDATA\electron-builder\Cache\nsis" -Recurse -Filter makensis.exe -ErrorAction SilentlyContinue |
    Where-Object { $_.Directory.Name -ne 'Bin' } | ForEach-Object FullName) |
  Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $makensis) { throw 'NSIS not found. Install it from https://nsis.sourceforge.io (makensis.exe).' }

$out = Join-Path $outRoot "FA-Management-$Version-Installers"
if (Test-Path $out) { Remove-Item $out -Recurse -Force }
New-Item -ItemType Directory -Force -Path $out | Out-Null

Write-Step 'Application setup EXE'
$stage = Join-Path $env:TEMP "fa-setup-stage-$Version"
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
robocopy $appKit $stage /E /NFL /NDL /NJH /NJS /NP | Out-Null
# the current deploy scripts (the kit may be older than a script fix)
Get-ChildItem $PSScriptRoot -File | Where-Object { $_.Name -notmatch '^(release|package-.*)\.(ps1|bat)$' -and $_.Name -ne 'environments.json' } |
  Copy-Item -Destination (Join-Path $stage 'deploy') -Force
# Node.js goes with the application, so the server needs no separate installation
$node = Get-Node
New-Item -ItemType Directory -Force -Path (Join-Path $stage 'runtime') | Out-Null
Copy-Item $node (Join-Path $stage 'runtime\node.exe')
$license = Join-Path (Split-Path -Parent $node) 'LICENSE'
if (Test-Path $license) { Copy-Item $license (Join-Path $stage 'runtime\LICENSE.txt') }
Write-Ok "Node.js $((& $node -v)) included"
$setupExe = Join-Path $out "FA-Management-Setup-$Version.exe"
& $makensis /V2 "/DVERSION=$Version" "/DKITDIR=$stage" $(if ($TestBuild) { '/DTESTBUILD' }) "/DOUTFILE=$setupExe" (Join-Path $PSScriptRoot 'installer\fa-setup.nsi')
if ($LASTEXITCODE -ne 0) { throw 'makensis failed (application setup).' }
Remove-Item $stage -Recurse -Force
Write-Ok "$(Split-Path -Leaf $setupExe) ($([math]::Round((Get-Item $setupExe).Length / 1MB, 1)) MB)"

Write-Step 'Database setup EXE'
$info = "production data of $($backup.LastWriteTime.ToString('dd-MM-yyyy HH:mm'))"
$dbExe = Join-Path $out "FA-Management-Database-$Version.exe"
& $makensis /V2 "/DVERSION=$Version" "/DBACKUP=$($backup.FullName)" "/DBACKUPINFO=$info" `
  "/DSCRIPT=$(Join-Path $PSScriptRoot 'setup-database.ps1')" "/DRUNNER=$(Join-Path $PSScriptRoot 'setup-run.ps1')" "/DOUTFILE=$dbExe" (Join-Path $PSScriptRoot 'installer\fa-database.nsi')
if ($LASTEXITCODE -ne 0) { throw 'makensis failed (database setup).' }
Copy-Item $backup.FullName (Join-Path $out "fa_management_$Version.backup")
Write-Ok "$(Split-Path -Leaf $dbExe) ($([math]::Round((Get-Item $dbExe).Length / 1MB, 1)) MB, $info)"

@"
FA Management System $Version - setup for a new server
=======================================================

Before: install PostgreSQL 16 or newer (remember the password of the user postgres).
        Node.js is NOT needed - it is inside the setup.

Database and application on the SAME server (usual):
  1. FA-Management-Setup-$Version.exe   (right-click > Run as administrator)
       - Database page: server localhost, port 5432, password of postgres,
         application login fa_app and a new strong password for it.
       - Data page: Browse... > fa_management_$Version.backup  (the existing data),
         or leave empty for an empty database (first user admin / admin123).
       - Finish > Open FA Management:  http://localhost:3100

Database on a SEPARATE server:
  1. On the database server: double-click FA-Management-Database-$Version.exe.
     It creates the login and databases and restores the data built into it.
  2. On the application server (PostgreSQL Command Line Tools installed there):
     FA-Management-Setup-$Version.exe with that server's name, the same login and password,
     password of postgres EMPTY and the backup file EMPTY.

Restore by hand instead: pgAdmin > right-click the new, empty fa_management > Restore... >
Format Custom > fa_management_$Version.backup > Do not save Owner.

The .backup file and the Database EXE contain all business data and the user accounts
(passwords encrypted): keep them on secure internal storage only, never in a public place.
Uninstall: Apps & features > FA Management System (the database and backups are kept).
Server must stay awake: the setup does it (first option on the Data page); later or on an
existing server: Start menu > FA Management System > Server settings (keep awake).
"@ | Set-Content (Join-Path $out 'README.txt') -Encoding ascii

Write-Step 'Update package (for a server that runs an older version)'
$upd = Join-Path $outRoot "FA-Management-$Version-Update"
if (Test-Path $upd) { Remove-Item $upd -Recurse -Force }
$updKit = Join-Path $upd 'update\kit'
robocopy (Join-Path $Source "releases\$Version") (Join-Path $updKit "releases\$Version") /E /NFL /NDL /NJH /NJS /NP | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $updKit 'deploy') | Out-Null
Get-ChildItem $PSScriptRoot -File | Where-Object { $_.Name -notmatch '^(release|package-.*)\.(ps1|bat)$' -and $_.Name -ne 'environments.json' } |
  Copy-Item -Destination (Join-Path $updKit 'deploy')
'install-new-server.bat', 'Configure-Server.bat', 'start-app.bat', 'stop-app.bat', 'start-staging.bat', 'stop-staging.bat' |
  ForEach-Object { Copy-Item (Join-Path $Source $_) $updKit }
robocopy (Join-Path $Source 'docs\guides') (Join-Path $updKit 'docs') /E /NFL /NDL /NJH /NJS /NP | Out-Null
Copy-Item (Join-Path $PSScriptRoot 'update-server.ps1') (Join-Path $upd 'update')
Copy-Item (Join-Path $Source 'Update-Server.bat') $upd
$notes = Join-Path $Source "docs\updates\Update-Notes-$Version.txt"
if (Test-Path $notes) { Copy-Item $notes (Join-Path $upd "UPDATE-NOTES-$Version.txt") }
@"
FA Management System - update to version $Version (all data is kept)
=====================================================================

For a server that already runs FA Management (installed with the setup EXE or the kit).
No data is changed: only the application and, if a version needs them, add-only database
changes. Users can keep working until step 4.

1. Copy this folder to the server (any place, e.g. the desktop).
2. Right-click Update-Server.bat > Run as administrator.
   It copies version $Version into the installation, takes a full backup of the production
   database (environments\production\backups\..._before_update_$Version...), and installs
   the version on Staging / UAT - a fresh copy of the production data.
3. Open http://<server>:3300 (orange banner), sign in as Admin, check the screens, and
   approve $Version in Administration > Releases.
4. Run Update-Server.bat again (as administrator). It installs $Version on Production:
   another backup, the update, a health check, and an automatic rollback if anything fails.
   Then it compares every business table before and after (rows and content) and reports
   "No data changed", and it sets the server so it never sleeps and starts FA Management
   and PostgreSQL by itself after a restart.
   Users sign in again after the update (about 1 minute without the application).

Installation not in C:\FA: Update-Server.bat -AppFolder D:\FA
Back to the previous version: deploy\rollback.ps1 -Env production (in the installation).
"@ | Set-Content (Join-Path $upd 'README.txt') -Encoding ascii
$updZip = "$upd.zip"
if (Test-Path $updZip) { Remove-Item $updZip -Force }
Compress-Archive -Path (Join-Path $upd '*') -DestinationPath $updZip
Write-Ok "$(Split-Path -Leaf $updZip) ($([math]::Round((Get-Item $updZip).Length / 1MB, 1)) MB)"

Write-Step 'Server settings (for a server installed earlier)'
$settings = Join-Path $outRoot 'FA-Management-Server-Settings'
if (Test-Path $settings) { Remove-Item $settings -Recurse -Force }
New-Item -ItemType Directory -Force -Path $settings | Out-Null
Copy-Item (Join-Path $Source 'Configure-Server.bat'), (Join-Path $PSScriptRoot 'configure-server.ps1') $settings
@"
FA Management System - keep the server available
=================================================

Problem: when the server sleeps, office PCs cannot reach FA Management; after a restart
the application may not start by itself.

1. Copy this folder to the server, e.g. into the application folder (C:\FA).
2. Right-click Configure-Server.bat > Run as administrator.
3. Enter the working hours for Windows Update (Enter = 7-23), and read the report:
   every line should be green.

What it sets (safe to run again at any time):
  - Power: High performance; never sleep, hibernate or turn off the disk; Fast Startup off;
    laptop lid / sleep button do nothing; network adapters stay powered.
  - PostgreSQL service: starts with Windows, restarts itself after a failure.
  - FA Management: starts with Windows (Task Scheduler, as SYSTEM) and is checked every
    5 minutes - started again if it stopped.
  - Windows Update: no automatic restart during the working hours or while someone is
    signed in.

Only check (changes nothing, no administrator needed): double-click Configure-Server.bat,
or  powershell -ExecutionPolicy Bypass -File configure-server.ps1 -CheckOnly
Application not in C:\FA:  powershell -ExecutionPolicy Bypass -File configure-server.ps1 -AppFolder D:\FA

Also recommended: a UPS for the server (power cuts), and restarting it for Windows
updates outside working hours. After a restart wait about 1-2 minutes, then
http://<server>:3100 works again by itself.
"@ | Set-Content (Join-Path $settings 'README.txt') -Encoding ascii
Write-Ok $settings

Write-Ok "Installers: $out"
exit 0
