@echo off
REM ============================================================
REM  FA Management System - start PRODUCTION (the installed release)
REM    http://localhost:3100
REM  Versions are installed with deploy\deploy.bat production <version>.
REM  Until the first release is installed, this starts the development copy.
REM ============================================================
setlocal
title FA Management System - Production
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy\env.ps1" -Env production -Action start
if errorlevel 1 (
  echo.
  echo  Production is not installed yet - starting the development copy instead.
  call "%~dp0start-dev.bat"
  exit /b
)
start "" "http://localhost:3100"
timeout /t 5 >nul
