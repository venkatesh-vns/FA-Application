# Runs one step of the setup EXEs in its own window, with a log file:
#   setup-run.ps1 -Log <file> -Script <path of setup-database.ps1 / install-new-server.ps1> [-Name value | -Switch] ...
# The EXE waits for this window only (not for the application it starts). On an error the window
# stays open until Enter is pressed, so the message can be read.
param(
  [Parameter(Mandatory)][string]$Log,
  [Parameter(Mandatory)][string]$Script,
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$Rest
)
# "-Name value" pairs and "-Switch" alone, passed on by name
$named = @{}
for ($i = 0; $i -lt $Rest.Count; $i++) {
  $name = $Rest[$i].TrimStart('-').TrimEnd(':')
  if ($i + 1 -lt $Rest.Count -and $Rest[$i + 1] -notmatch '^-[A-Za-z]') { $named[$name] = $Rest[$i + 1]; $i++ }
  else { $named[$name] = $true }
}
$Host.UI.RawUI.WindowTitle = "FA Management setup - $([IO.Path]::GetFileNameWithoutExtension($Script))"
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Log) | Out-Null
Start-Transcript -Path $Log -Append | Out-Null
$code = 0
try { & $Script @named; if ($LASTEXITCODE) { $code = $LASTEXITCODE } }
catch { $code = 1; Write-Host ''; Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red }
Stop-Transcript | Out-Null
if ($code -ne 0 -and $env:FA_SETUP_SILENT -ne '1') {
  Write-Host ''
  Write-Host "The setup stopped. The messages are saved in $Log" -ForegroundColor Yellow
  Read-Host 'Press Enter to close this window' | Out-Null
}
exit $code
