# stream-record v0.0.1

Windows에서 마이크 음성과 PC 재생 음성을 서로 분리해 녹음·실시간 전사하고, 전사 원문을 회의록과 요약본으로 정리하는 한국어 데스크톱 앱입니다. Meetily Community Edition 기반이며 한국어 작업 화면은 보호된 overlay로 적용됩니다.

## 설치

1. GitLab의 [v0.0.1 릴리스](https://gitlab.aigov.go.kr/memory365/streamrecord/-/releases/v0.0.1)에서 `stream-record.exe`를 내려받습니다.
2. 내려받은 파일은 Windows x64용 설치 프로그램입니다. 실행 후 안내에 따라 설치합니다.
3. 현재 설치 파일은 코드 서명 인증서가 없어 Windows가 경고할 수 있습니다. 파일의 SHA-256은 릴리스 설명과 함께 확인하세요.
4. 첫 실행 후 `음성 모델 설정`에서 **Local Whisper 다국어 모델**을 내려받고 선택합니다. `.en` 모델은 한국어용이 아닙니다.

## 두 가지 녹음 방식

- `외부 소리 녹음 (마이크)`: 선택한 마이크 입력만 사용합니다. 마이크 선택 목록에서는 Stereo Mix와 출력 장치를 제외합니다.
- `PC 소리 녹음 (Stereo Mix)`: Windows의 `Stereo Mix` 입력만 사용해 PC에서 재생되는 소리를 받습니다. 마이크 입력으로 자동 대체하지 않습니다.

두 방식 모두 별도의 시스템 오디오 트랙을 동시에 켜지 않습니다. 녹음 전에는 반드시 참여자에게 알리고 화면의 권한 확인란을 선택해야 합니다.

`Stereo Mix`가 보이지 않으면 Windows **설정 > 시스템 > 소리 > 모든 사운드 장치** 또는 제어판의 **소리 > 녹음**에서 사용하지 않는 장치 표시 후 활성화하세요. 오디오 드라이버가 Stereo Mix를 제공하지 않는 PC에서는 PC 소리 녹음 버튼을 사용할 수 없습니다.

## 유튜브 링크 전사

유튜브 링크를 넣고 `영상 재생 + 전사`를 누르면 앱 안 영상 창을 열고, 재생되는 소리를 Stereo Mix로 받아 실시간 전사합니다. 영상을 다운로드하지 않으며 영상 길이만큼 재생 시간이 필요합니다. 영상 창에서 직접 재생을 눌러야 할 수 있고, 음소거하면 전사되지 않습니다. 저작권과 녹음 권한을 확인한 콘텐츠에만 사용하세요.

## 회의록 만들기

녹음을 중지한 뒤 전사 원문을 확인하고 요약 모델을 선택해 `회의록·요약본 생성`을 누릅니다. 구독 모델을 선택하면 전사문이 해당 서비스로 전송되며, 로컬 Ollama 모델은 PC 안에서 처리합니다. 자동 화자 식별은 제공하지 않으며 결과의 이름, 수치, 결정사항은 원문과 대조해야 합니다.

원문 TXT, 회의록 Markdown, 원문·요약 JSON은 Windows 문서 폴더의 `Meetily-Korean\Exports`에 저장됩니다. 최근 작업은 10초 간격으로 복구 저장됩니다.

## 소스 빌드

필요 도구: Node.js 20 이상, npm, Git, Rust/Cargo, Visual Studio C++ Build Tools, CMake, LLVM/Clang.

```powershell
Set-Location -LiteralPath "C:\Users\Rumans\Documents\Codex\meetily-korean"
node setup.mjs doctor
node setup.mjs check
.\BUILD.cmd
```

`apply.mjs`는 `UPSTREAM_COMMIT.txt`에 기록된 Meetily 원본에 overlay를 적용합니다. 원본 파일은 수정 전에 백업하고, 예상하지 못한 사용자 수정이 있으면 덮어쓰지 않고 중단합니다.

Tauri 식별자 `local.meetily.korean.workspace`는 이전 Meetily-Korean 빌드의 설정과 내려받은 모델 경로를 이어 쓰기 위해 유지합니다. 제품명과 실행 파일명만 `stream-record`로 변경합니다.

주요 소스:

- `overlay/frontend/src/components/meeting-ko/KoreanWorkspace.tsx`: 한국어 녹음·전사·요약 화면
- `overlay/frontend/src/components/meeting-ko/core.ts`: 장치 필터링과 전사·요약 로직
- `overlay/frontend/src-tauri/src/meeting_ko.rs`: Tauri 녹음·저장·요약 연결
- `overlay/frontend/src/components/KoreanLocalizer.tsx`: 원본 설정 화면 한국어 현지화
- `tests/run.cjs`: overlay와 핵심 로직 회귀 검사

## v0.0.1 검증 범위

- Windows x64 CPU 빌드 및 NSIS 설치 파일 생성: 통과
- 독립 로직/패처 테스트 32개: 통과
- TypeScript 엄격 검사와 Rust `cargo check --locked`: 통과
- 최종 EXE 기동, 한국어 화면, 실제 Windows 입력 장치 열거, 마이크/Stereo Mix 버튼 분리, 1250/768/375px 레이아웃: 통과
- 실제 마이크 주변음 녹음, 실제 Stereo Mix 음성 캡처, Whisper 추론, 장시간 회의, 실제 모델 요약: 개인정보 및 모델 준비가 필요한 물리 시험이므로 수행하지 않음

기반 저장소: <https://github.com/Zackriya-Solutions/meetily>
라이선스: MIT. 원본 라이선스와 저작권 표시는 유지합니다.
