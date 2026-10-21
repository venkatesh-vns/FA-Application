@echo off
REM deploy\deploy.bat staging^|production <version>   e.g. deploy\deploy.bat staging 1.1.0
setlocal
if "%~1"=="" (
  echo  Usage: deploy\deploy.bat staging^|production <version>   e.g. deploy\deploy.bat staging 1.1.0
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy.ps1" -Env %1 -Version %2 %3
exit /b %errorlevel%
