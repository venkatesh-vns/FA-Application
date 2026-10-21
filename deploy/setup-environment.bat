@echo off
REM deploy\setup-environment.bat staging^|production
setlocal
if "%~1"=="" (
  echo  Usage: deploy\setup-environment.bat staging^|production
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-environment.ps1" -Env %1
exit /b %errorlevel%
