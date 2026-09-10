@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 오늘 할 일

echo.
echo   ── 오늘 할 일 ──────────────────────────────
echo   폴더: %CD%
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo   [!] Node.js 가 설치되어 있지 않습니다.
  echo       https://nodejs.org 에서 LTS 를 설치한 뒤 다시 실행해 주세요.
  echo.
  pause
  exit /b 1
)

if not exist "package.json" (
  echo   [!] 이 파일이 desktop-todo 폴더 안에 있지 않습니다.
  echo       package.json 이 있는 폴더로 옮긴 뒤 실행해 주세요.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\electron" (
  echo   처음 실행입니다. 필요한 파일을 내려받습니다 ^(2~5분^)...
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo   [!] 설치에 실패했습니다. 위 메시지를 확인해 주세요.
    pause
    exit /b 1
  )
)

echo   앱을 시작합니다. 이 창은 켜 둔 채로 두세요.
echo   창이 안 뜨면 이미 트레이(시계 옆)에 실행 중입니다.
echo   트레이 아이콘 우클릭 - 종료 후 다시 실행해 주세요.
echo.

call npm start

if errorlevel 1 (
  echo.
  echo   [!] 실행 중 오류가 발생했습니다. 위 메시지를 확인해 주세요.
  pause
)
