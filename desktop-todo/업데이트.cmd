@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 오늘 할 일 - 업데이트
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0update.ps1"
echo.
pause
