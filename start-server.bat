@echo off
echo 正在安装依赖...
call npm install

echo.
echo 正在启动服务器...
echo 服务器地址: http://localhost:3000
echo.

node server.js

pause
