@echo off
chcp 65001 >nul
title Face Recognition Server
python -m http.server 8080
