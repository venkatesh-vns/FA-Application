@echo off
REM ============================================================
REM  FA Management System - update an installed server
REM  Right-click > Run as administrator.
REM  Run 1: backup, new version on Staging / UAT -> an Admin approves it there
REM  Run 2: new version on Production (backup, rollback on failure, data check),
REM         then the server settings (no sleep, start after a restart)
REM  All master and transaction data is kept.
REM ============================================================
setlocal
title FA Management System - Update
cd /d "%~dp0"
net session >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Please right-click Update-Server.bat and choose "Run as administrator".
  echo.
  pause
  exit /b 1
)
set HOURS=
set /p HOURS=Working hours without Windows Update restarts, e.g. 7-23 (Enter = 7-23, N = leave as it is):
if "%HOURS%"=="" set HOURS=7-23
if /i "%HOURS%"=="N" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0update\update-server.ps1" %*
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0update\update-server.ps1" -ActiveHours %HOURS% %*
)
echo.
pause
