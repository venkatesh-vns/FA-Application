@echo off
REM deploy\rollback.bat staging^|production
setlocal
if "%~1"=="" (
  echo  Usage: deploy\rollback.bat staging^|production
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0rollback.ps1" -Env %1
exit /b %errorlevel%
