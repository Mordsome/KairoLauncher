@echo off
rem Starts Kairo Launcher from this folder (dev build with the offline dev account).
cd /d "%~dp0"
set "PATH=%ProgramFiles%\nodejs;%PATH%"
where npm >nul 2>nul || (echo Node.js is not installed. Get it from https://nodejs.org & pause & exit /b 1)
if not exist node_modules (
  echo First start: installing what the launcher needs...
  call npm install || (pause & exit /b 1)
)
call npm run dev:offline
