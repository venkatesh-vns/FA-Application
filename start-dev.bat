@echo off
REM ============================================================
REM  FA Management System - DEVELOPMENT copy (from the source code)
REM    API -> http://localhost:5101  (server window)
REM    App -> http://localhost:3101  (client window, reloads on code changes)
REM  Users work on Production (start-app.bat). Changes are released with
REM  deploy\release.bat and tested on Staging before Production.
REM ============================================================
setlocal
title FA Management System - Development
cd /d "%~dp0"

echo.
echo  FA Management System - DEVELOPMENT
echo  ==================================
echo.

REM --- Node.js must be installed ---
where node >nul 2>nul
if errorlevel 1 (
  echo  [ERROR] Node.js is not installed. Install it from https://nodejs.org and try again.
  echo.
  pause
  exit /b 1
)

REM --- Database settings must exist ---
if not exist "server\.env" (
  echo  [ERROR] server\.env is missing. Copy server\.env.example to server\.env
  echo          and set DB_PASSWORD, then run this file again.
  echo.
  pause
  exit /b 1
)

REM --- First run: install packages ---
if not exist "server\node_modules" (
  echo  Installing server packages, first run only...
  call npm --prefix server install --no-audit --no-fund
  if errorlevel 1 goto :installfail
)
if not exist "client\node_modules" (
  echo  Installing app packages, first run only - this can take a few minutes...
  call npm --prefix client install --no-audit --no-fund
  if errorlevel 1 goto :installfail
)

REM --- Apply any new database changes (does nothing when up to date) ---
pushd server
call npm run migrate --silent
if errorlevel 1 (
  popd
  echo.
  echo  [ERROR] Database update failed. Check that PostgreSQL is running and server\.env is correct.
  pause
  exit /b 1
)
popd

REM --- Start the API unless it is already running ---
netstat -ano | findstr /r /c:":5101 .*LISTENING" >nul
if errorlevel 1 (
  echo  Starting API on port 5101...
  start "FA Management - API (port 5101)" /min cmd /k "cd /d "%~dp0server" && set PORT=5101&& set CLIENT_URL=http://localhost:3101&& set APP_ENV=development&& npm start"
) else (
  echo  API is already running on port 5101.
)

REM --- Start the screens unless they are already running ---
netstat -ano | findstr /r /c:":3101 .*LISTENING" >nul
if errorlevel 1 (
  echo  Starting app on port 3101...
  start "FA Management - App (port 3101)" /min cmd /k "cd /d "%~dp0client" && set PORT=3101&& npm start"
) else (
  echo  App is already running on port 3101.
)

REM --- Wait until the app answers, then open the browser ---
echo.
echo  Waiting for the application to be ready...
set /a tries=0
:wait
timeout /t 3 /nobreak >nul
set /a tries+=1
netstat -ano | findstr /r /c:":3101 .*LISTENING" >nul
if errorlevel 1 (
  if %tries% lss 40 goto :wait
  echo  [WARN] The app is taking long to start. Check the "FA Management - App" window.
)
timeout /t 3 /nobreak >nul
start "" "http://localhost:3101"

echo.
echo  The application is running:  http://localhost:3101
echo  Login: admin / admin123  (change the password in Users)
echo.
echo  To stop it, run stop-dev.bat or close the two "FA Management" windows.
echo.
timeout /t 10 >nul
exit /b 0

:installfail
echo.
echo  [ERROR] Package installation failed. Check your internet connection and try again.
pause
exit /b 1
