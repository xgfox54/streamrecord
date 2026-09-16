@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20 이상을 설치한 뒤 다시 실행하세요.
  pause
  exit /b 1
)
node setup.mjs dev cpu
if errorlevel 1 (
  echo 실행 또는 빌드에 실패했습니다. 위 오류를 확인하세요.
  pause
  exit /b 1
)