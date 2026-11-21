@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20.9 이상과 Rust 및 Windows C++ 빌드 도구가 필요합니다.
  pause
  exit /b 1
)
echo 한국어 음성모델을 설치파일에 포함합니다. 모델이 없으면 빌드 시 다운로드하고 검증합니다.
node tools\package-korean-bundled.mjs --build
if errorlevel 1 (
  echo 패키징에 실패했습니다. outputs 폴더의 package-result.json과 로그를 확인하세요.
  pause
  exit /b 1
)
echo 설치 파일 경로는 위 출력의 installer.path 항목에서 확인하세요.
pause
