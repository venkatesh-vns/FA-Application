@echo off
REM ============================================================
REM  FA Management System - install on a NEW server
REM  Before: Node.js 22 + PostgreSQL installed, and the database
REM  kit's setup-database.sql run in pgAdmin (as postgres).
REM  Run this file as Administrator (for firewall / auto-start).
REM ============================================================
setlocal
title FA Management System - New server installation
cd /d "%~dp0"
echo.
echo  FA Management System - new server installation
echo  ===============================================
echo.
set /p DBHOST=Database server [localhost]:
if "%DBHOST%"=="" set DBHOST=localhost
set /p DBPORT=Database port [5432]:
if "%DBPORT%"=="" set DBPORT=5432
set /p DBNAME=Database name [fa_management]:
if "%DBNAME%"=="" set DBNAME=fa_management
set /p DBUSER=Database login [fa_app]:
if "%DBUSER%"=="" set DBUSER=fa_app
set /p ROOT=Install folder [C:\FA]:
if "%ROOT%"=="" set ROOT=C:\FA
set /p APPPORT=Application port [3100]:
if "%APPPORT%"=="" set APPPORT=3100
echo.
echo  Existing data: drag the .backup file from the database kit here and press Enter,
echo  or just press Enter to start with an empty database.
set /p BACKUP=Backup file:
set BACKUP=%BACKUP:"=%
echo.
if "%BACKUP%"=="" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy\install-new-server.ps1" -DbHost "%DBHOST%" -DbPort %DBPORT% -DbName "%DBNAME%" -DbUser "%DBUSER%" -InstallRoot "%ROOT%" -Port %APPPORT% -WithStaging -Autostart -OpenFirewall
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy\install-new-server.ps1" -DbHost "%DBHOST%" -DbPort %DBPORT% -DbName "%DBNAME%" -DbUser "%DBUSER%" -InstallRoot "%ROOT%" -Port %APPPORT% -RestoreBackup "%BACKUP%" -WithStaging -Autostart -OpenFirewall
)
echo.
pause
