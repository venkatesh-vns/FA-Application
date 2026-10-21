@echo off
REM deploy\release.bat <version>   e.g. deploy\release.bat 1.1.0
setlocal
if "%~1"=="" (
  echo  Usage: deploy\release.bat <version>   e.g. deploy\release.bat 1.1.0
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0release.ps1" -Version %1
exit /b %errorlevel%
