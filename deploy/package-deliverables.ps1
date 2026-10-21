# Collects the hand-over deliverables of a released version into one folder:
#   deliverables\FA-Management-<version>\
#     1-Application    production build (release zip) + source code (Git archive)
#     2-Database       structure script (schema.sql), migrations, seed script, and
#                      a full backup of production (.backup for pgAdmin / pg_restore, .sql plain)
#     3-Configuration  .env template, environments, Nginx / IIS reverse proxy, Docker files
#     4-Documentation  installation, on-premises, cloud migration, backup & restore,
#                      version control guides, release notes and its template
#   deploy\package-deliverables.ps1 -Version 1.1.0 [-NoBackup]
# The production backup contains real data: keep the folder secure.
param(
  [Parameter(Mandatory)][string]$Version,
  [switch]$NoBackup
)
. "$PSScriptRoot\common.ps1"
$rel = Join-Path $Source "releases\FA-Management-$Version.zip"
if (-not (Test-Path $rel)) { throw "Release $Version not found. Run deploy\release.bat $Version first." }
$out = Join-Path $Source "deliverables\FA-Management-$Version"
if (Test-Path $out) { Remove-Item $out -Recurse -Force }
$app = Join-Path $out '1-Application'; $db = Join-Path $out '2-Database'; $cfg = Join-Path $out '3-Configuration'; $doc = Join-Path $out '4-Documentation'
New-Item -ItemType Directory -Force -Path $app, $db, $cfg, $doc | Out-Null

Write-Step 'Application'
Copy-Item $rel $app
if ((Get-Command git -ErrorAction SilentlyContinue) -and (Test-Path (Join-Path $Source '.git'))) {
  Push-Location $Source
  git archive --format=zip -o (Join-Path $app "FA-Management-$Version-source.zip") "v$Version"
  Pop-Location
  Write-Ok "Production build and source code (Git tag v$Version)."
} else { Write-Warn2 'Git not available: source code not packaged.' }

Write-Step 'Database'
$prod = Get-Env 'production'
robocopy (Join-Path $Source 'database\migrations') (Join-Path $db 'migrations') /E /NFL /NDL /NJH /NJS /NP | Out-Null
Copy-Item (Join-Path $Source 'server\scripts\seedAdmin.js') $db
# the structure of this version: staging runs the version under test (production may still be on the one before)
$stage = Get-Env 'staging'
$schema = Invoke-DeployTool @('schema', '--env', $stage.ConfigFile, '--out', (Join-Path $db 'schema.sql'))
Write-Ok "schema.sql ($([math]::Round($schema.bytes / 1KB)) KB), migrations, seedAdmin.js"
if (-not $NoBackup) {
  $b = Invoke-DeployTool @('backup', '--env', $prod.ConfigFile, '--name', "handover_$Version")
  Copy-Item $b.file $db
  $sql = Invoke-DeployTool @('backup-sql', '--env', $prod.ConfigFile, '--out', (Join-Path $db "$($prod.Db)_backup_$Version.sql"))
  Write-Ok "Production backup: $(Split-Path -Leaf $b.file) ($([math]::Round($b.bytes / 1MB, 1)) MB) and plain SQL ($([math]::Round($sql.bytes / 1MB, 1)) MB)"
}

Write-Step 'Configuration'
Copy-Item (Join-Path $Source 'server\.env.example') (Join-Path $cfg 'env.example.txt')
Copy-Item (Join-Path $PSScriptRoot 'environments.json') $cfg
robocopy (Join-Path $PSScriptRoot 'nginx') (Join-Path $cfg 'nginx') /E /NFL /NDL /NJH /NJS /NP | Out-Null
robocopy (Join-Path $PSScriptRoot 'iis') (Join-Path $cfg 'iis') /E /NFL /NDL /NJH /NJS /NP | Out-Null
Copy-Item (Join-Path $Source 'Dockerfile'), (Join-Path $Source 'docker-compose.yml') $cfg
Write-Ok '.env template, environments, Nginx, IIS, Docker.'

Write-Step 'Documentation'
robocopy (Join-Path $Source 'docs\guides') $doc /E /NFL /NDL /NJH /NJS /NP | Out-Null
Copy-Item (Join-Path $Source 'RELEASE_NOTES.md'), (Join-Path $Source 'README.md') $doc
Write-Ok 'Guides, release notes, README.'

Write-Host ''
Write-Host "Deliverables: $out" -ForegroundColor Green
if (-not $NoBackup) { Write-Host 'This folder contains a backup with real data. Store and share it securely.' -ForegroundColor Yellow }
exit 0
