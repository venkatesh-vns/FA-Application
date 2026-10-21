@echo off
REM ============================================================
REM  FA Management System - stop PRODUCTION
REM ============================================================
setlocal
title FA Management System - Stop
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy\env.ps1" -Env production -Action stop
REM the older way of running (development servers on 5100 / 3100), if still running
for %%P in (5100 3100) do (
  for /f "tokens=5" %%I in ('netstat -ano ^| findstr /r /c:":%%P .*LISTENING"') do (
    taskkill /PID %%I /T /F >nul 2>nul
  )
)
echo.
echo  FA Management System stopped.
timeout /t 3 >nul
