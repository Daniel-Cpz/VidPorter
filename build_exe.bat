@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Install Node.js 22 or newer, then reopen this script.
  echo https://nodejs.org/
  pause
  exit /b 1
)
call npm ci
if errorlevel 1 goto failed
call npm test
if errorlevel 1 goto failed
call npm run build
if errorlevel 1 goto failed
echo.
echo Build completed. The VidPorter installer and portable Windows EXE are in dist.
explorer dist
pause
exit /b 0
:failed
echo.
echo Build failed. Please read the error above.
pause
exit /b 1
