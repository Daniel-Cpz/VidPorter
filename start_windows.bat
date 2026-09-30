@echo off
setlocal
cd /d "%~dp0"
if not exist node_modules\electron\dist\electron.exe (
  call npm install
  if errorlevel 1 goto failed
)
call npm start
if errorlevel 1 goto failed
exit /b 0
:failed
echo Start failed. Install Node.js 22 or newer and check the error above.
pause
exit /b 1
