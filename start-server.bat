@echo off
chcp 65001 >nul
echo Installing dependencies...
call npm install

echo.
echo Starting server...
echo Server address: http://localhost:8080

node server/server.js
pause
