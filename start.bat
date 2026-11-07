@echo off
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Install Node.js 22 or newer and reopen this window so PATH includes node.
  pause
  exit /b 1
)
echo Trapstar forum — local preview only. Live hosting needs a Node server, not this PC.
node server.js
echo.
echo Server stopped.
pause
