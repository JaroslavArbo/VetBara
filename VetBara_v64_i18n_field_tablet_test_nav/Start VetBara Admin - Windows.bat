@echo off
setlocal
cd /d "%~dp0"
set "NODE_BIN="
if exist "%~dp0runtime\win-x64\node.exe" set "NODE_BIN=%~dp0runtime\win-x64\node.exe"
if "%NODE_BIN%"=="" (
  where node >nul 2>nul
  if not errorlevel 1 set "NODE_BIN=node"
)
if "%NODE_BIN%"=="" (
  echo Node runtime is missing. Installing it now...
  powershell -ExecutionPolicy Bypass -File "%~dp0Install runtime - Windows.ps1" -NoPrompt
  if exist "%~dp0runtime\win-x64\node.exe" set "NODE_BIN=%~dp0runtime\win-x64\node.exe"
)
if "%NODE_BIN%"=="" (
  echo Node runtime is still missing. Check internet access or install Node.js manually.
  pause
  exit /b 1
)
"%NODE_BIN%" "%~dp0app\server.cjs" --mode=admin
pause
