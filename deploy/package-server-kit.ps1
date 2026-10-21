# Builds the two kits for installing a released version on a NEW server:
#   deliverables\FA-Management-<version>-Application-Kit.zip   installer + application + scripts + guides (no data)
#   deliverables\FA-Management-<version>-Database-Kit.zip      database setup, structure, and the production data backup
#   deploy\package-server-kit.ps1 -Version 1.1.0 [-NoBackup]
param(
  [Parameter(Mandatory)][string]$Version,
  [switch]$NoBackup
)
. "$PSScriptRoot\common.ps1"
$pkg = Join-Path $Source "releases\$Version\app"
if (-not (Test-Path (Join-Path $pkg 'version.json'))) { throw "Release $Version not found. Run deploy\release.bat $Version first." }
$outRoot = Join-Path $Source 'deliverables'
$appKit = Join-Path $outRoot "FA-Management-$Version-Application-Kit"
$dbKit = Join-Path $outRoot "FA-Management-$Version-Database-Kit"
foreach ($d in $appKit, $dbKit) { if (Test-Path $d) { Remove-Item $d -Recurse -Force }; New-Item -ItemType Directory -Force -Path $d | Out-Null }
$copy = { param($from, $to) robocopy $from $to /E /NFL /NDL /NJH /NJS /NP | Out-Null }

Write-Step 'Application kit'
& $copy $pkg (Join-Path $appKit "releases\$Version\app")
New-Item -ItemType Directory -Force -Path (Join-Path $appKit 'deploy') | Out-Null
Get-ChildItem $PSScriptRoot -File | Where-Object { $_.Name -notmatch '^(release|package-.*)\.(ps1|bat)$' } | Copy-Item -Destination (Join-Path $appKit 'deploy')
& $copy (Join-Path $PSScriptRoot 'nginx') (Join-Path $appKit 'deploy\nginx')
& $copy (Join-Path $PSScriptRoot 'iis') (Join-Path $appKit 'deploy\iis')
# environments with the default server folders (the installer sets the real ones)
$envs = Get-Content (Join-Path $PSScriptRoot 'environments.json') -Raw | ConvertFrom-Json
$envs.root = 'C:\FA\environments'
($envs | ConvertTo-Json -Depth 5) | Set-Content (Join-Path $appKit 'deploy\environments.json') -Encoding ascii
'install-new-server.bat', 'start-app.bat', 'stop-app.bat', 'start-staging.bat', 'stop-staging.bat' | ForEach-Object { Copy-Item (Join-Path $Source $_) $appKit }
& $copy (Join-Path $Source 'docs\guides') (Join-Path $appKit 'docs')
Copy-Item (Join-Path $Source 'server\.env.example') (Join-Path $appKit 'docs\settings-reference.env.txt')
Copy-Item (Join-Path $Source 'Dockerfile'), (Join-Path $Source 'docker-compose.yml') (Join-Path $appKit 'docs')
@"
FA Management System $Version - Application kit for a new server
==================================================================

1. Install on the server: Node.js 22 LTS (all users, add to PATH) and PostgreSQL 16+
   (with pgAdmin and Command Line Tools). The database may be on another server: then
   install only the PostgreSQL Command Line Tools here.
2. Database kit: run setup-database.sql in pgAdmin (as postgres) on the database server.
   Change the password in it first.
3. Here, right-click install-new-server.bat > Run as administrator, and answer the questions:
   database server, port, name, login and password, install folder (C:\FA), port (3100),
   and the .backup file of the database kit to bring the existing data (or Enter for an
   empty database - a first Admin admin / admin123 is then created; change it at once).
4. Open http://localhost:3100 (office PCs: http://<this server>:3100).

The installer writes the settings (C:\FA\environments\production\config.env, with a new
JWT_SECRET), restores the data if given, installs the application, creates / updates the
tables, starts it, checks it, opens the firewall port and makes it start with Windows.

Later versions: copy the new release into releases\<version>\ and follow
docs\05-Version-Control-Guide.md (staging, approval, production).
Guides: docs\01 ... 05.   Start / stop: start-app.bat / stop-app.bat.
"@ | Set-Content (Join-Path $appKit 'README-INSTALL.txt') -Encoding ascii
Ok "Application kit: $appKit"

Write-Step 'Database kit'
Copy-Item (Join-Path $Source 'database\setup-database.sql'), (Join-Path $Source 'database\schema.sql') $dbKit
& $copy (Join-Path $Source 'database\migrations') (Join-Path $dbKit 'migrations')
if (-not $NoBackup) {
  $prod = Get-Env 'production'
  if (-not (Test-Path $prod.ConfigFile)) { throw 'Production is not set up on this machine, so no data backup can be taken (use -NoBackup).' }
  $b = Invoke-DeployTool @('backup', '--env', $prod.ConfigFile, '--name', "for_new_server_$Version")
  Copy-Item $b.file $dbKit
  $sql = Invoke-DeployTool @('backup-sql', '--env', $prod.ConfigFile, '--out', (Join-Path $dbKit "$($prod.Db)_data_$Version.sql"))
  Ok "Production data backup: $(Split-Path -Leaf $b.file) ($([math]::Round($b.bytes / 1MB, 1)) MB) + plain SQL"
}
@"
FA Management System $Version - Database kit
==============================================

setup-database.sql   Run once on the database server as postgres (pgAdmin > Query Tool).
                     Creates the login fa_app and the databases fa_management (production),
                     fa_management_staging (UAT) and fa_management_archive. Change the password first.
*.backup             The production data at $(Get-Date -Format 'dd-MM-yyyy HH:mm'). The application kit's
                     installer restores it (answer its last question with this file), or in
                     pgAdmin: right-click fa_management > Restore... > Format Custom > this file >
                     Do not save Owner. Restore only into a NEW, empty database.
*_data_*.sql         The same data as plain SQL (any SQL tool / psql -f).
schema.sql           The structure only (no data) of version $Version, for an empty installation.
migrations\          The database changes; the application applies them itself.

The backup contains all business data and user accounts (passwords encrypted).
Keep this kit on secure internal storage; never put it in a public place or repository.
"@ | Set-Content (Join-Path $dbKit 'README-DATABASE.txt') -Encoding ascii
Ok "Database kit: $dbKit"

Write-Step 'Zipping'
foreach ($d in $appKit, $dbKit) {
  $zip = "$d.zip"
  if (Test-Path $zip) { Remove-Item $zip -Force }
  Compress-Archive -Path (Join-Path $d '*') -DestinationPath $zip
  Ok "$(Split-Path -Leaf $zip) ($([math]::Round((Get-Item $zip).Length / 1MB, 1)) MB)"
}
exit 0
