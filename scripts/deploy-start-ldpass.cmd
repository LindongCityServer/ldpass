@echo off
setlocal

set "NODE24=%LDPASS_NODE24%"
if "%NODE24%"=="" set "NODE24=C:\node-v24\node.exe"

if not exist "%NODE24%" (
  echo [ldpass] Node v24 runtime not found: %NODE24%
  echo [ldpass] Install Node v24 at C:\node-v24, or set LDPASS_NODE24 to node.exe.
  exit /b 1
)

cd /d "%~dp0"
"%NODE24%" "%~dp0deploy-start.mjs" %*
exit /b %ERRORLEVEL%
