# Prepares a release package: releases\<version>\app (+ .zip)
#   deploy\release.ps1 -Version 1.1.0
# Checks: version newer than the last one, RELEASE_NOTES.md has a section for it,
# database changes are add-only, all automated tests pass, the source is
# committed (Git). Then: version.json, screens build, package, Git commit + tag.
param(
  [Parameter(Mandatory)][string]$Version,
  [switch]$SkipTests,   # only for an emergency fix; the tests normally must pass
  [switch]$NoGit        # package without committing / tagging
)
. "$PSScriptRoot\common.ps1"

if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "Version must look like 1.2.0 (MAJOR.MINOR.PATCH)." }
$vjson = Join-Path $Source 'version.json'
$current = (Get-Content $vjson -Raw | ConvertFrom-Json).version
$git = (Get-Command git -ErrorAction SilentlyContinue) -and (Test-Path (Join-Path $Source '.git')) -and -not $NoGit
$tagExists = $false
if ($git) { Push-Location $Source; $tagExists = [bool](git tag --list "v$Version"); Pop-Location }
if ($tagExists) { throw "Version $Version was already released (Git tag v$Version exists). Use a new version number." }
if ([version]$Version -lt [version]$current) { throw "Version $Version must not be older than the current version $current." }

Write-Step "Release $Version"
$notes = Get-Content (Join-Path $Source 'RELEASE_NOTES.md') -Raw
if ($notes -notmatch "(?m)^## v?$([regex]::Escape($Version))\b") { throw "RELEASE_NOTES.md has no section '## $Version - <date>'. Write the release notes first." }
Write-Ok 'Release notes found.'

if ($git) {
  Push-Location $Source
  $dirty = git status --porcelain | Where-Object { $_ -notmatch '(RELEASE_NOTES\.md|version\.json)$' }
  Pop-Location
  if ($dirty) { throw "There are uncommitted changes. Commit them first, so the release is exactly the tested code:`n$($dirty -join "`n")" }
  Write-Ok 'Source is committed.'
}

Write-Step 'Checking database changes (add-only)'
Push-Location (Join-Path $Source 'server')
& (Get-Node) scripts\checkMigrations.js
if ($LASTEXITCODE -ne 0) { Pop-Location; throw 'Migration check failed: a database change could alter existing data.' }
if (-not $SkipTests) {
  Write-Step 'Running the automated tests'
  npm test --silent
  if ($LASTEXITCODE -ne 0) { Pop-Location; throw 'Tests failed. Fix them before releasing.' }
  Write-Ok 'All tests passed.'
} else { Write-Warn2 'Tests skipped (-SkipTests).' }
Pop-Location

Write-Step 'Setting the version'
$commit = ''
if ($git) { Push-Location $Source; $commit = (git rev-parse --short HEAD 2>$null); Pop-Location }
$info = [ordered]@{ version = $Version; releasedAt = (Get-Date -Format 'yyyy-MM-dd'); commit = "$commit" }
($info | ConvertTo-Json) | Set-Content -Path $vjson -Encoding ascii
Write-Ok "version.json: $Version"

Write-Step 'Building the screens'
Push-Location (Join-Path $Source 'client')
$env:GENERATE_SOURCEMAP = 'false'
npm run build --silent
if ($LASTEXITCODE -ne 0) { Pop-Location; throw 'The screens could not be built.' }
Pop-Location

Write-Step 'Packaging'
$rel = Join-Path $Source "releases\$Version"
$app = Join-Path $rel 'app'
if (Test-Path $rel) { Remove-Item $rel -Recurse -Force }
New-Item -ItemType Directory -Force -Path $app | Out-Null
# server without tests, local settings or uploads
$serverOut = Join-Path $app 'server'
robocopy (Join-Path $Source 'server') $serverOut /E /NFL /NDL /NJH /NJS /NP /XD node_modules tests uploads /XF .env *.log | Out-Null
robocopy (Join-Path $Source 'server\node_modules') (Join-Path $serverOut 'node_modules') /E /NFL /NDL /NJH /NJS /NP | Out-Null
Push-Location $serverOut
npm prune --omit=dev --no-audit --no-fund --silent | Out-Null
Pop-Location
robocopy (Join-Path $Source 'client\build') (Join-Path $app 'client\build') /E /NFL /NDL /NJH /NJS /NP | Out-Null
robocopy (Join-Path $Source 'database\migrations') (Join-Path $app 'database\migrations') /E /NFL /NDL /NJH /NJS /NP | Out-Null
Copy-Item $vjson, (Join-Path $Source 'RELEASE_NOTES.md') $app
$zip = Join-Path $Source "releases\FA-Management-$Version.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path (Join-Path $app '*') -DestinationPath $zip
Write-Ok "Package: $app"
Write-Ok "Zip:     $zip ($([math]::Round((Get-Item $zip).Length / 1MB, 1)) MB)"

if ($git) {
  Write-Step 'Git: commit and tag'
  Push-Location $Source
  git add version.json RELEASE_NOTES.md | Out-Null
  git commit --allow-empty -m "Release $Version" | Out-Null
  git tag -a "v$Version" -m "Release $Version"
  Pop-Location
  Write-Ok "Tagged v$Version"
}

Write-Host ''
Write-Host "Release $Version is ready. Next: deploy\deploy.bat staging $Version" -ForegroundColor Green
