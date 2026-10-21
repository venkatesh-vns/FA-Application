@echo off
REM ============================================================
REM  FA Management System - stop the DEVELOPMENT copy (ports 5101, 3101)
REM ============================================================
setlocal
title FA Management System - Stop development
echo.
for %%P in (5101 3101) do (
  for /f "tokens=5" %%I in ('netstat -ano ^| findstr /r /c:":%%P .*LISTENING"') do (
    echo  Stopping process %%I on port %%P...
    taskkill /PID %%I /T /F >nul 2>nul
  )
)
echo.
echo  Development copy stopped.
timeout /t 3 >nul
