@echo off
REM ============================================================
REM  FA Management System - keep the server available
REM  Right-click > Run as administrator. Run once on the server
REM  (again after big Windows updates - it is safe to repeat).
REM   - never sleep / hibernate, Fast Startup off, network stays on
REM   - PostgreSQL starts with Windows and restarts after a failure
REM   - FA Management starts with Windows, checked every 5 minutes
REM   - optional: no Windows Update restarts in working hours
REM ============================================================
setlocal
title FA Management System - Server settings
cd /d "%~dp0"
set SCRIPT=%~dp0deploy\configure-server.ps1
if not exist "%SCRIPT%" set SCRIPT=%~dp0configure-server.ps1
net session >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Please right-click Configure-Server.bat and choose "Run as administrator".
  echo  Showing the current state only:
  powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" -CheckOnly
  echo.
  pause
  exit /b 1
)
echo.
echo  Windows Update: no automatic restarts during working hours.
set /p HOURS=Working hours, e.g. 7-23 (Enter = 7-23, N = leave as it is):
if "%HOURS%"=="" set HOURS=7-23
if /i "%HOURS%"=="N" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%"
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" -ActiveHours %HOURS%
)
echo.
pause
