@echo off
setlocal
cd /d "%~dp0"
title Roblox AI Bridge
color 0B

if not exist "bridge\logs" mkdir "bridge\logs"

echo ============================================
echo Roblox AI Bridge
echo Dossier : %cd%
echo Console : bridge\logs\server.log
echo Appuie sur Ctrl+C pour arreter proprement.
echo ============================================
echo.

node "bridge\server.js"
set EXITCODE=%ERRORLEVEL%

echo.
if not "%EXITCODE%"=="0" (
  echo Le bridge s'est arrete avec le code %EXITCODE%.
  echo Regarde la console ci-dessus ou le fichier bridge\logs\server.log
) else (
  echo Le bridge s'est arrete proprement.
)
echo.
pause
exit /b %EXITCODE%
