@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
node setup.mjs build cpu
if errorlevel 1 (
  echo 빌드 실패. 성공한 EXE가 생성되었다고 간주하지 마세요.
  pause
  exit /b 1
)
echo 빌드 명령이 종료되었습니다. 출력 로그의 실제 산출물 경로를 확인하세요.
pause