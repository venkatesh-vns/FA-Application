@echo off
REM FA Management System - stop STAGING (SP): http://localhost:3300
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy\env.ps1" -Env staging -Action stop
timeout /t 5 >nul
