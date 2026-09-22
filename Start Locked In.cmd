@echo off
title Locked In
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js isn't installed, and the local server needs it.
  echo   Get it from https://nodejs.org  ^(the LTS button^), then run this again.
  echo.
  pause
  exit /b 1
)

echo.
echo   Starting Locked In...
echo.

start "" http://localhost:8931/extension/setup.html
node tools/serve.mjs

echo.
echo   Server stopped.
pause
