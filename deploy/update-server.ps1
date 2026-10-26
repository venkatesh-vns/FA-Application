# Updates an installed FA Management server to the version in this update package,
# keeping every piece of data.
#
#   Update-Server.bat                     (right-click > Run as administrator; run it again after the approval)
#   powershell -ExecutionPolicy Bypass -File update\update-server.ps1 [-AppFolder C:\FA] [-ActiveHours 7-23] [-NoServerSettings]
#
# Run 1: copies the new version into the installation, takes a full backup of the production
#        database, and installs the version on Staging / UAT (a fresh copy of production).
#        An Admin checks it there and approves it in Administration > Releases.
# Run 2: (approved) installs it on Production: backup, database changes (add-only), start,
#        health check, automatic rollback on any failure. Then it proves that no data changed
#        (rows and content of every business table, before and after), and applies the
#        server settings (no sleep, start after a restart).
param(
  [string]$AppFolder,
  [string]$ActiveHours,
  [switch]$NoServerSettings
)
$ErrorActionPreference = 'Stop'
function Step($t) { Write-Host ''; Write-Host "==> $t" -ForegroundColor Cyan }
function Ok($t) { Write-Host "    $t" -ForegroundColor Green }
function Warn($t) { Write-Host "    $t" -ForegroundColor Yellow }

$pkgRoot = Join-Path $PSScriptRoot 'kit'
$Version = (Get-ChildItem (Join-Path $pkgRoot 'releases') -Directory | Where-Object { $_.Name -match '^\d+\.\d+\.\d+$' } |
  Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1).Name
if (-not $Version) { throw 'This update package contains no release.' }

# ---------- the installation
if (-not $AppFolder) {
  $reg = Get-ItemProperty 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\FA-Management' -ErrorAction SilentlyContinue
  $AppFolder = if ($reg.InstallLocation) { $reg.InstallLocation } else { 'C:\FA' }
}
$kit = @("$AppFolder\kit", $AppFolder) | Where-Object { Test-Path (Join-Path $_ 'deploy\environments.json') } | Select-Object -First 1
if (-not $kit) { throw "FA Management was not found in $AppFolder. Run with -AppFolder <the installation folder>." }
Write-Host "FA Management update to version $Version - installation $kit" -ForegroundColor White

# ---------- 1. new files into the installation (settings and data are not touched)
Step "Copying version $Version into the installation"
$target = Join-Path $kit "releases\$Version"
if (-not (Test-Path (Join-Path $target 'app\version.json'))) {
  robocopy (Join-Path $pkgRoot "releases\$Version") $target /E /NFL /NDL /NJH /NJS /NP | Out-Null
}
# scripts and guides of the new version; environments.json (folders, ports) is kept
Get-ChildItem (Join-Path $pkgRoot 'deploy') -File | Where-Object Name -ne 'environments.json' |
  Copy-Item -Destination (Join-Path $kit 'deploy') -Force
Get-ChildItem $pkgRoot -File | Copy-Item -Destination $kit -Force
if (Test-Path (Join-Path $pkgRoot 'docs')) { robocopy (Join-Path $pkgRoot 'docs') (Join-Path $kit 'docs') /E /NFL /NDL /NJH /NJS /NP | Out-Null }
Ok "releases\$Version, deploy scripts and guides updated."

. (Join-Path $kit 'deploy\common.ps1')
$prod = Get-Env 'production'
$stage = Get-Env 'staging'
if (-not (Test-Path $prod.ConfigFile)) { throw "Production settings not found: $($prod.ConfigFile)" }
$running = (Get-AppInfo $prod).version
Ok "Production runs version $(if ($running) { $running } else { '? (not answering)' })."
if ($running -eq $Version) { Ok "Production already runs $Version." }

# ---------- data fingerprint (rows + content checksum of every business table)
function Read-Settings($file) {
  $cfg = @{}
  Get-Content $file | Where-Object { $_ -match '^\s*([A-Z_]+)=(.*)$' } | ForEach-Object {
    $key = $Matches[1]; $v = $Matches[2].Trim()
    if ($v -match '^(["''`])(.*)\1$') { $v = $Matches[2] }   # quoted value (dotenv)
    $cfg[$key] = $v
  }
  $cfg
}
function Invoke-ProdSql($Env, [string]$Sql) {
  $cfg = Read-Settings $Env.ConfigFile
  $bin = if ($cfg.PG_DUMP_PATH) { Split-Path -Parent $cfg.PG_DUMP_PATH } else {
    Get-ChildItem "$env:ProgramW6432\PostgreSQL", "$env:ProgramFiles\PostgreSQL" -Directory -ErrorAction SilentlyContinue |
      Where-Object { Test-Path (Join-Path $_.FullName 'bin\psql.exe') } | Sort-Object { [double]($_.Name -replace '[^0-9.]', '') } -Descending |
      Select-Object -First 1 | ForEach-Object { Join-Path $_.FullName 'bin' } }
  $psql = Join-Path $bin 'psql.exe'
  if (-not (Test-Path $psql)) { throw 'psql.exe not found (PostgreSQL Command Line Tools).' }
  $env:PGPASSWORD = $cfg.DB_PASSWORD
  try {
    $ErrorActionPreference = 'Continue'
    $out = & $psql -h $(if ($cfg.DB_HOST) { $cfg.DB_HOST } else { 'localhost' }) -p $(if ($cfg.DB_PORT) { $cfg.DB_PORT } else { '5432' }) `
      -U $cfg.DB_USER -d $cfg.DB_NAME -w -X -A -t -c $Sql 2>&1
    $code = $LASTEXITCODE
  } finally { $env:PGPASSWORD = $null; $ErrorActionPreference = 'Stop' }
  if ($code -ne 0) { throw "Reading the data failed: $($out -join ' ')" }
  @($out | ForEach-Object { "$_" } | Where-Object { $_ -ne '' })
}

# business tables and their columns: table -> 'col1,col2,...' (sign-ins, logs and release records excluded)
function Get-Columns($Env) {
  $map = [ordered]@{}
  Invoke-ProdSql $Env @"
select c.table_name || '|' || string_agg(quote_ident(c.column_name), ',' order by c.ordinal_position)
from information_schema.columns c join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
  and c.table_name not in ('sessions', 'qty_locks', 'app_releases', 'activity_log', 'login_attempts', 'schema_migrations')
group by c.table_name order by 1
"@ | ForEach-Object { $t, $c = $_ -split '\|', 2; $map[$t] = $c }
  $map
}

# rows + content checksum of every table, over the columns that existed BEFORE the update,
# so a new (added) column does not count as a change of the existing data
function Get-Fingerprint($Env, $Columns) {
  $parts = foreach ($t in $Columns.Keys) {
    "select '$t | ' || count(*) || ' | ' || md5(coalesce(string_agg(x, '#' order by x), '')) from (select (row($($Columns[$t])))::text as x from public.`"$t`") s"
  }
  Invoke-ProdSql $Env (($parts -join "`nunion all ") + "`norder by 1")
}
if ($running -ne $Version) {
  # ---------- 2. full backup of production, kept apart from the automatic ones
  Step 'Full backup of the production database'
  $b = Invoke-DeployTool @('backup', '--env', $prod.ConfigFile, '--name', "before_update_$Version")
  Ok "$($b.file) ($([math]::Round($b.bytes / 1MB, 2)) MB) - restore with pgAdmin if ever needed."

  # ---------- 3. staging, then approval
  $approved = $true
  try { Invoke-DeployTool @('check-approval', '--env', $stage.ConfigFile, '--version', $Version) | Out-Null } catch { $approved = $false }
  if (-not $approved) {
    if (-not (Test-Path $stage.ConfigFile)) { throw "Staging / UAT is not set up ($($stage.ConfigFile)). Set it up with deploy\setup-environment.ps1 -Env staging, then run this again." }
    if ((Get-AppInfo $stage).version -ne $Version) {
      Step "Installing $Version on Staging / UAT (a copy of the production data)"
      powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $kit 'deploy\deploy.ps1') -Env staging -Version $Version
      if ($LASTEXITCODE -ne 0) { throw 'Installing on Staging failed (see above). Production was not changed.' }
    }
    Write-Host ''
    Write-Host "NEXT: open http://$($env:COMPUTERNAME):$($stage.Port) (Staging / UAT, orange banner), sign in as Admin," -ForegroundColor Yellow
    Write-Host "      check the screens, then approve $Version in Administration > Releases." -ForegroundColor Yellow
    Write-Host '      Then run Update-Server.bat again: it installs the version on Production.' -ForegroundColor Yellow
    Write-Host '      Production keeps running unchanged until then.' -ForegroundColor Yellow
    exit 3
  }

  # ---------- 4. production
  Step 'Data before the update'
  $columns = Get-Columns $prod
  $before = Get-Fingerprint $prod $columns
  Ok "$($before.Count) tables read (rows and content)."
  powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $kit 'deploy\deploy.ps1') -Env production -Version $Version
  if ($LASTEXITCODE -ne 0) { throw 'The production update failed and was rolled back (see above). The data is as before.' }

  Step 'Data after the update'
  $after = Get-Fingerprint $prod $columns
  $diff = Compare-Object $before $after
  if ($diff) {
    Warn 'Differences found:'; $diff | ForEach-Object { Warn "$($_.SideIndicator) $($_.InputObject)" }
    throw "The data differs after the update. Restore from $($b.file) if needed, and report this."
  }
  Ok "No data changed: all $($after.Count) tables have the same rows and the same values in every existing column."
  # new tables / columns of this version (add-only database changes)
  $now = Get-Columns $prod
  foreach ($t in $now.Keys) {
    if (-not $columns.Contains($t)) { Ok "New table: $t"; continue }
    $added = ($now[$t] -split ',') | Where-Object { ($columns[$t] -split ',') -notcontains $_ }
    foreach ($c in $added) { Ok "New column: $t.$c (existing rows: empty / default value)" }
  }
  $after | ForEach-Object { $p = $_ -split ' \| '; if ([int]$p[1] -gt 0) { Ok ("{0,-22} {1,8} rows" -f $p[0], $p[1]) } }
}

# ---------- 5. server settings: no sleep, start after a restart
if (-not $NoServerSettings) {
  Step 'Server settings (no sleep, start after a restart)'
  $cs = @{ AppFolder = $AppFolder }
  if ($ActiveHours) { $cs.ActiveHours = $ActiveHours }
  & (Join-Path $kit 'deploy\configure-server.ps1') @cs
}

Write-Host ''
Write-Host "FA Management $Version is running on Production: http://$($env:COMPUTERNAME):$($prod.Port)" -ForegroundColor Green
exit 0
