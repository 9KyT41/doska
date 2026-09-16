@echo off
cd /d "%~dp0"
start "DOSKA server" cmd /k "npx --yes http-server -p 8080 -c-1 ."
timeout /t 2 /nobreak >nul
start "" http://localhost:8080