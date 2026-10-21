@echo off
REM FA Management System - start STAGING (SP): http://localhost:3300
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy\env.ps1" -Env staging -Action start
if not errorlevel 1 start "" "http://localhost:3300"
timeout /t 5 >nul
