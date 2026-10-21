# Shared helpers of the release / deployment scripts.
$ErrorActionPreference = 'Stop'
$Source = Split-Path -Parent $PSScriptRoot                      # the application source folder
$Config = Get-Content (Join-Path $PSScriptRoot 'environments.json') -Raw | ConvertFrom-Json
$DeployTool = Join-Path $Source 'server\scripts\deployTool.js'
# server kit (no source code): use the deployTool of the newest release package
if (-not (Test-Path (Join-Path $Source 'server\node_modules'))) {
  $newest = Get-ChildItem (Join-Path $Source 'releases') -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '^\d+\.\d+\.\d+$' } | Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1
  if ($newest) { $DeployTool = Join-Path $newest.FullName 'app\server\scripts\deployTool.js' }
}

function Write-Step($text) { Write-Host ''; Write-Host "==> $text" -ForegroundColor Cyan }
function Write-Ok($text) { Write-Host "    $text" -ForegroundColor Green }
function Write-Warn2($text) { Write-Host "    $text" -ForegroundColor Yellow }

function Get-Env([string]$Name) {
  $e = $Config.$Name
  if (-not $e) { throw "Unknown environment '$Name' (use staging or production)." }
  $dir = Join-Path $Config.root $Name
  [pscustomobject]@{
    Name = $Name; Label = $e.label; Port = [int]$e.port; Db = $e.db
    Dir = $dir; App = (Join-Path $dir 'app'); Previous = (Join-Path $dir 'previous')
    ConfigFile = (Join-Path $dir 'config.env'); Backups = (Join-Path $dir 'backups')
    Logs = (Join-Path $dir 'logs'); Run = (Join-Path $dir 'run')
  }
}

# 96 random hex characters for JWT_SECRET
function New-JwtSecret {
  $bytes = New-Object byte[] 48
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  -join ($bytes | ForEach-Object { $_.ToString('x2') })
}

# settings written before a setting existed get it now (JWT_SECRET)
function Update-ConfigFile($Env) {
  $text = Get-Content $Env.ConfigFile -Raw
  if ($text -notmatch '(?m)^JWT_SECRET=.{32,}') {
    $text = ($text -replace '(?m)^JWT_SECRET=.*\r?\n?', '').TrimEnd() + "`r`nJWT_SECRET=$(New-JwtSecret)`r`n"
    Set-Content -Path $Env.ConfigFile -Value $text -Encoding ascii -NoNewline
    Write-Ok 'JWT_SECRET added to the settings.'
  }
}

function Get-Node {
  # the setup EXE brings its own Node.js
  $bundled = Join-Path $Source 'runtime\node.exe'
  if (Test-Path $bundled) { return $bundled }
  $n = Get-Command node -ErrorAction SilentlyContinue
  if (-not $n) { throw 'Node.js is not installed (node was not found on PATH).' }
  $n.Source
}

# runs deployTool.js; returns its JSON result, throws with its message on failure
function Invoke-DeployTool([string[]]$ToolArgs) {
  $node = Get-Node
  $out = & $node $DeployTool @ToolArgs 2>&1
  if ($LASTEXITCODE -ne 0) { throw (($out | Out-String).Trim()) }
  ($out | Select-Object -Last 1) | ConvertFrom-Json
}

function Test-Port([int]$Port) {
  [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

function Get-AppInfo($Env) {
  try { Invoke-RestMethod -Uri "http://localhost:$($Env.Port)/api/app-info" -TimeoutSec 5 } catch { $null }
}

function Start-AppEnv($Env) {
  if (-not (Test-Path (Join-Path $Env.App 'server\server.js'))) { throw "$($Env.Label) is not installed yet. Deploy a version first." }
  if (Test-Port $Env.Port) { Write-Warn2 "Port $($Env.Port) is already in use; $($Env.Label) seems to be running."; return }
  New-Item -ItemType Directory -Force -Path $Env.Logs, $Env.Run | Out-Null
  $p = Start-Process -FilePath (Get-Node) -ArgumentList 'server.js' -WorkingDirectory (Join-Path $Env.App 'server') `
    -WindowStyle Hidden -RedirectStandardOutput (Join-Path $Env.Logs 'app.out.log') -RedirectStandardError (Join-Path $Env.Logs 'app.err.log') -PassThru
  Set-Content -Path (Join-Path $Env.Run 'app.pid') -Value $p.Id
  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 500
    if (Get-AppInfo $Env) { Write-Ok "$($Env.Label) is running: http://localhost:$($Env.Port)"; return }
    if ($p.HasExited) { break }
  }
  $err = Get-Content (Join-Path $Env.Logs 'app.err.log') -Tail 15 -ErrorAction SilentlyContinue | Out-String
  throw "$($Env.Label) did not start. Last errors:`n$err"
}

function Stop-AppEnv($Env) {
  $pidFile = Join-Path $Env.Run 'app.pid'
  if (Test-Path $pidFile) {
    $id = [int](Get-Content $pidFile)
    Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
    Remove-Item $pidFile -Force
  }
  # anything else still listening on the port that is node
  Get-NetTCPConnection -LocalPort $Env.Port -State Listen -ErrorAction SilentlyContinue | ForEach-Object {
    $proc = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue
    if ($proc -and $proc.ProcessName -eq 'node') { Stop-Process -Id $proc.Id -Force }
  }
  for ($i = 0; $i -lt 20 -and (Test-Port $Env.Port); $i++) { Start-Sleep -Milliseconds 500 }
  Write-Ok "$($Env.Label) stopped."
}
