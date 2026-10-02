# Stream-Record 새 세션 인계 (2026-10-02 KST)

## 사용자 요청

현재 진행 상황을 확인한 뒤 새 세션을 열고 이어서 작업하라는 명시적 요청으로 작성했다. 상태 설명만 하지 말고 아래 실제 테스트에서 드러난 문제의 수정·검증을 진행한다.

## 실제 작업 위치와 안전 조건

- 정본 저장소: `C:/Users/Public/Documents/ESTsoft/CreatorTemp/streamrecord-v0.5.0-candidate/work/publish-v0.5.0-1790639934680`
- 정본 소스는 저장소의 `app/`. `overlay/` 재적용 금지. 루트 및 하위 AGENTS.md를 읽는다.
- 이전 채팅 작업 폴더: `C:/Users/Rumans/Documents/Codex/2026-09-17/stream-record-krds-uiux-md-assets`. 이 폴더를 정본 앱 저장소로 혼동하지 않는다. 예전 D: 경로로 되돌리거나 복사하지 않는다.
- 인계 확인 시 HEAD: `aea7ce1f0fd131f55679933913ffce906b4c83a4`, 커밋 제목은 v0.5.0이지만 현재 소스 package.json은 0.6.2다. Git 상태 138개 항목이 변경/미추적이었다. 이 인계 문서 추가 전 수치다. 기존 누적 변경을 모두 보존하며 reset/checkout/clean 하지 않는다.
- 실행 프로세스 점검에서 stream-record/cargo/rustc/makensis는 없었다. 여러 다른 node 프로세스는 있었으므로 종료하지 않았다. 새 세션 시작 시 재확인한다.
- 협업 에이전트 목록은 root만 실행 중이었다. 환경에 보이는 과거 에이전트 이름을 실행 중인 작업으로 간주하지 않는다.
- 원본 아이콘은 assets/streamrecord-icon-source.png이며 내부 배경/도형 변경 금지.
- 녹음, 실시간 원문 보존, 한국어 Whisper 설치파일 동봉을 유지한다. 사용자 기록/모델/설정 삭제 금지, 앱 식별자와 기존 데이터 경로를 임의 변경하지 않는다.

## 완료된 버전과 검증

- v0.6.2: 상시 펼친 최대 1280×720 YouTube, 조밀한 원문/AI 보정본, 고정 녹음 옵션, 요약 시간 별도 줄/빨간 확인 문장, 분야별 8개 용어집. 자세한 증거는 `docs/V062_VALIDATION.md`와 `outputs/ui-video-v062/final-verification.json`.
- 기존 기록상 회귀 248건, 브라우저 108캡처 및 실제 설치 화면 확인 완료. 이는 이번 인계 중 재실행한 테스트가 아니다.
- 설치본: `C:/Users/Rumans/AppData/Local/stream-record/stream-record.exe`.
- 설치파일 존재 재확인: `outputs/korean-bundled-0.6.2/Stream-Record-0.6.2-korean-bundled-windows-x64-setup.exe`, 626724757바이트.
- v0.6.2 GitLab/Google Drive 게시 미완료. 기존 배포 승인 이력은 있지만 미게시를 완료로 보고하면 안 된다. 이전 토큰이 저장돼 있다고 가정하지 않는다.

## 최근 실제 테스트와 재현 증거 (최우선)

`outputs/youtube-Fjx45gnbEuA-1790862727532/TEST_REPORT.md` 및 같은 폴더의 metrics.json, test-session.json, transcript-comparison.json, 01~08 JPG를 먼저 읽는다.

- 영상: https://www.youtube.com/watch?v=Fjx45gnbEuA
- 내장 플레이어 → Stereo Mix(Realtek(R) Audio) → 동봉 small-q5_1 → 기존 연결 gpt-5.6-luna. 새 마이크 녹음은 수행하지 않았다.
- 영상 0:00~3:17 관찰, 이후 5:02~7:24 연속 발언 2분 22초 테스트. 전체 영상 검증 아님.
- 새 테스트 recordId: `20f9f4f6-e7b1-483a-a475-5a7e0ee08db3`, 제목 `유튜브 실사용 테스트 Fjx45gnbEuA · v0.6.2`.
- 전사 37구간 저장 성공. AI 보정 29구간 적용, 8구간 미완료. 재시도해도 같은 중단 재현.
- 오류: `AI가 숫자를 바꾼 보정본은 적용하지 않았습니다. 원음을 확인하세요.` 숫자 보호를 제거해서 통과시키지 말 것. 문제 구간을 별도 표시하고 나머지 처리 지속, 재시도/중복/원문 보존을 검토한다.
- 일부 보정 성공: 일일 비하지 → 일희일비하지, 공간위원장 연속회의 → 공천위원장 연석회의. 인명/표현 오류는 남았다. 오디오 확인 없이 인명/숫자를 추측 보정하지 않는다.
- 요약에 보정 전 오류가 남았다. 보정 데이터와 요약의 입력/체크포인트 무효화/진행 중 응답 경쟁을 조사한다.
- `[확인 필요]` 제거 후 `의미는.`, `기한은.` 같은 불완전 문장 표시. 원문은 보존하면서 사용자 요청인 빨간 텍스트와 표시 토큰 제거를 유지하고 자연스러운 문장을 구현한다.
- 대기/현장 잡음 구간에서 감사합니다 반복. 실제 발언인지 환각인지 미확정이며 음성 검증 없이 전부 삭제하지 않는다.
- 현재 데이터: `C:/Users/Rumans/AppData/Local/local.meetily.korean.workspace/meeting-ko/last-session.json`, `records/*.json`은 {summary,snapshot} 구조.
- 테스트 음성: `C:/Users/Rumans/Music/meetily-recordings/유튜브 실사용 테스트 Fjx45gnbEuA · v0.6.2_2026-10-01_13-54/audio.mp4`, AAC 48kHz mono, 519.23초, 11498227바이트, SHA256 `33a8e346ee3106f35575b8ead4ecfc0bcc7f916c32979feb575263eef89b7b98`.
- 기존 94구간 원문과 음성 경로 불변을 테스트 후 확인했다. 사용자 데이터는 그 후 달라질 수 있으므로 옛 백업으로 덮어쓰지 않는다.
- 테스트에서 켠 자동 보정/실시간 요약은 종료 후 원래대로 껐다. 보정 결과와 요약은 저장돼 있다.

## 다음 실행 순서

1. 경로, 변경 상태, 실행 작업, 데이터와 새 버전 유무를 재확인한다. 기존 작업을 보존한다.
2. 재현 증거와 해당 훅/로직을 읽고 숫자 보호가 전체 보정을 막는 문제, 보정→요약 반영, 어색한 확인 문장 문제를 최소 변경으로 고친다. 관련 후보: useTranscriptCorrection.ts, transcript-correction.ts, useLiveSummary.ts, live-summary.ts, summary-display.ts, Rust meeting_ko 하위 모듈. 읽기 전 원인을 단정하지 않는다.
3. 회귀 테스트, 타입 검사, 영향 범위 Rust 검사, 실제 UI와 보존한 음성/동일 영상 재검증. 한국어 모델/녹음 기능과 원문 불변을 검증한다. 실계정/실기기와 모의 시험을 분리한다.
4. 검증된 다음 버전 설치파일을 생성하고 기존 사용자 기록을 저장·백업한 뒤 설치 교체 및 실제 실행 확인을 진행한다. 원래 세션에 설치 교체 승인이 있으며 중복 승인 요청은 하지 않는다. 현재 사용 중인 앱을 강제 종료하지 않는다.
5. 이전 사용자 승인 범위인 GitLab과 Drive 배포도 새 버전 검증 후 진행하되, 자격정보 부재/실패는 명확히 보고한다. GitLab: https://gitlab.aigov.go.kr/memory365/streamrecord . Drive: https://drive.google.com/drive/folders/1RoPRdfUsovgGqykxdCHF4rxkNg6M2bgX . 토큰은 채팅이나 로그로 노출하지 않고 필요 시 사용자가 볼 수 있는 안전한 입력 경로를 사용한다.

범위를 넘어 모든 미검증 환경을 완료로 만들려 하지 않는다. 과거 남은 범위는 docs/V060_IMPROVEMENT_STATUS.md 및 docs/UNFINISHED_IMPROVEMENTS_AUDIT_20261001.md 참고: 실시간 화자 스트리밍, 한국어 다화자 DER, Claude/Antigravity 직접 구독 로그인, 각 외부 프록시 실계정·전원 단절/장치 이탈 시험 등은 별도 미완료/미검증 항목이다.

## 도구 관련 경험

- Windows shell은 git_bash 우선, Windows 프로세스 확인만 PowerShell 사용.
- 네이티브 GUI는 computer-use 스킬을 읽고 Sky 사용. get_window_state가 16×16 아이콘 두 장과 실제 큰 창 이미지를 함께 반환한 사례가 있다. 좌표 동작에는 가장 큰 screenshot의 id를 명시하고 매 동작 후 상태를 다시 관찰한다.
- 이전 UI 증거에는 Codex 데스크톱 오버레이가 보인다. 앱 문제와 혼동하지 않고 오버레이를 자동 조작하지 않는다.
- 구현, 테스트, 설치파일 생성, 설치본 교체, GitLab 게시, Drive 업로드를 각각 구분해 보고한다.
