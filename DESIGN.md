# Stream-Record Design System

## 1. Atmosphere & Identity
KRDS 확장형을 적용한 한국어 업무 기록 도구. 준비 → 실시간 기록 → 전사 검토 → 회의록 작성의 흐름을 실제 작업별 탐색 링크로 나눈다. 회의 녹음, 받아쓰기, YouTube 전사는 같은 녹음·전사 엔진과 단일 세션 컨트롤러를 사용하며 화면 전환과 무관하게 유지한다. 이미지 정본은 `assets/branding/streamrecord-icon-source.png`이며 내부 배경·도형·색을 변경하지 않는다.

## 2. Color
모든 화면은 `workspace.module.css`의 scoped `--sr-*` 토큰을 사용한다.

| Token | Value | Purpose |
|---|---|---|
| brand-blue / action-primary-bg | #0173bc | 주요 행동·선택 |
| brand-orange / progress-accent | #f18101 | 녹음 상태 |
| brand-green / success-accent | #00a074 | 완료 상태 |
| surface | #ffffff | 화면·입력 |
| surface-subtle | #f4f5f6 | 앱 바탕 |
| surface-selected | #eaf4fb | 선택 메뉴 |
| text | #1e2124 | 본문·주황/초록 위 글자 |
| text-subtle | #464c53 | 설명 |
| border-control | #6d7882 | 조작 컨트롤 경계 |
| border-subtle | #cdd1d5 | 비조작 영역 경계 |
| primary-hover / primary-pressed | #005f9e / #004b7c | 주요 행동 상태 |
| focus | #004b7c | 3px 외곽 초점 |
| danger / danger-surface | #a02024 / #fff1f1 | 오류·종료 확인 |
| disabled-bg / disabled-text | #e6e8ea / #464c53 | 비활성 상태 |
| overlay | rgba(0,0,0,.55) | 모달 뒤 배경 |

파랑 위 흰색, 주황·초록 위 text 토큰을 사용한다. 필수 컨트롤 경계에 주황만 사용하지 않는다. 상태는 반드시 문구를 동반한다.

## 3. Typography
외부 폰트 요청 없이 `system-ui, -apple-system, Malgun Gothic, sans-serif`. 기본 본문·입력·버튼 `1.0625rem` (기본 17px), line-height 1.6. 제목 `2rem`, 섹션 `1.375rem`, 부가 설명 `.9375rem`. 시간 숫자는 ui-monospace, tabular-nums. 표시 설정은 루트 글자 크기 100/112.5/125%로 rem 전체를 확대한다.

## 4. Spacing & Layout
간격 토큰 .25/.5/.75/1/1.5/2/2.5rem. 데스크톱 앱 헤더·왼쪽 14rem 탐색·작업 본문. 앱 셸은 100dvh 안에서 헤더와 탐색 위치를 유지하고 본문만 스크롤한다. 실시간 기록 화면은 데스크톱에서 입력/미디어와 전사·요약을 2열로 배치하며 각 긴 결과 영역이 자신의 스크롤을 소유한다. 980px 이하 탐색은 상단 줄바꿈, 실시간 2열은 한 열로 바뀐다. 본문 최대 88rem, 카드 padding 1.5rem, 좁은 화면 1rem. 600px 이하 두 열 폼은 한 열. 긴 한국어·경로는 줄바꿈하고 모든 grid column은 minmax(0,1fr). 고정 하단 바를 두지 않는다.

## 5. Components
- AppShell: 실제 브랜드 이미지, 작업 그룹이 보이는 hash 링크, aria-current, 녹음 상태, 항상 접근 가능한 중지 동작. `기록` 그룹은 회의 녹음·받아쓰기·YouTube 전사를 분리하고 `결과` 그룹은 전체 전사·회의록을 제공한다. 화면 전환 시 h1 또는 요청한 근거 행으로 초점.
- ActionButton: 48px 최소 높이, 44px 최소 너비, 기본/주요/중지, hover/active/focus-visible/disabled. 녹음 시작은 방식 선택 후 단일 주 버튼.
- Form: 보이는 label, 필드별 도움말, native radio/select/checkbox. disabled 이유를 인접 설명으로 제공.
- StatusBadge: 대기/녹음/완료 문구와 색, timer는 native 시작 성공 이후에만 표시. 가짜 파형·진행률 없음.
- LiveTranscriptPanel: 진행 중인 부분 문장을 마지막 행에서 교체하고 확정 문장을 누적한다. 읽기 위치를 보존하며 최신 구간 이동을 명시적으로 제공한다. 화면에는 실제 전사 문자열만 표시하고 가짜 예시 문장을 사용하지 않는다.
- LiveSummaryPanel: 확정 전사만 사용해 현재까지의 핵심 내용을 갱신한다. 선택한 로컬/구독 모델과 전송 위치를 표시하고, 모델이 없으면 녹음과 전사를 막지 않은 채 AI 연결 화면으로 안내한다.
- MediaFrame: 검증된 YouTube 주소만 `youtube-nocookie.com/embed/{id}` 내부 프레임으로 표시한다. 영상 다운로드·자동 재생을 하지 않으며 프레임 바로 아래에 LiveTranscriptPanel을 배치한다.
- LiveSessionWorkspace: 진행 상태, 경과 시간, 확정/부분 전사 수, 실시간 요약 상태를 한 화면에서 확인한다. 회의 녹음은 전사와 요약을 함께, 받아쓰기는 전사를 우선, YouTube는 미디어와 전사를 우선한다.
- TranscriptRow: 최초 원문·검토본 구분, 안정적인 전체 원문 S ID, 듣기·수정·저장. 검색/페이지는 원본 인덱스를 유지. 편집·수동 스크롤은 follow를 중지. 새 구간 개수 및 명시적 최신 이동.
- Disclosure: native details/summary로 고급 설정·원음 복구·라이선스.
- Dialog: 설치된 Radix Dialog, focus trap/복귀, 계속 사용 기본 초점, 종료 전 stop 완료와 persist 성공 요구. 실패하면 앱을 종료하지 않음.
- AiConnectionCard: 서버 모델 응답·인증·추론을 구분. 기존 Ollama/고정 프록시와 예정 계정/API 어댑터를 구분. 가짜 연결 버튼 없음.

## 6. Motion & Interaction
장식 애니메이션·점멸 없음. 초점·hover는 즉시 표시. 자동 스크롤은 실시간 전사 영역에만 적용하며 사용자가 과거 구간을 읽기 시작하면 중지한다. 요약 갱신은 상태 문구로 알리고 기존 요약을 지우지 않는다. reduced-motion에서 모든 자동 이동은 즉시 처리한다. 화면 전환은 컨트롤러를 unmount하지 않는다.

## 7. Depth & Surface
borders-only. 흰 작업 패널, 회색 페이지 배경, 파랑 선택 표식. 그림자·정부 상징·인증 마크 없음. 로고는 생성 이미지로 대체하지 않는다.

## 8. Accessibility Constraints & Accepted Debt
키보드 사용자, 확대 사용자, 긴 회의 원문을 검토하는 사용자에게 작업 위치와 상태를 보존한다. 최소 텍스트 대비 4.5:1, 필수 경계/초점 3:1. 메시지는 짧은 status/alert 영역에만 낭독하며 전사 전체 live 영역은 off. 새 확정 구간 수와 요약 갱신 상태만 polite status로 알린다. YouTube iframe에는 고유 title을 제공하고 iframe이 실패해도 전사·중지 조작은 유지한다. 모달 focus trap, 화면 제목/근거 초점, forced-colors 시스템 색, reduced-motion을 적용한다. 실제 Windows 화면 낭독기·고대비·장시간 하드웨어 녹음 검증은 별도 수용 검사 결과로만 판정한다. 새 다크 모드는 제공하지 않고 작업실은 명시적 밝은 팔레트를 유지한다.

## Sources and validation scope
2026-09-17 공식 KRDS 버튼 및 타이포그래피 가이드를 직접 확인했다. 2026-09-21 사용자 제공 A. 노트 상세 주소가 로그인된 Chrome 세션에서 열리는 것과 문서 제목은 확인했으나 해당 세션의 화면 캡처/DOM 추출은 브라우저 연결 시간 초과로 완료하지 못했다. 대신 SK텔레콤 공식 공개 소개와 공개 화면의 `실시간 요약`·`받아쓰기` 정보 구조를 참고했다. 픽셀·문구·상표를 복제하지 않고 녹음 중 현재 결과를 한 작업 화면에서 읽는 구조만 적용한다. 공식 CSS/JS 패키지는 도입하지 않으며 기존 React/native 컴포넌트에 확장형 원칙을 적용한다. 공식 인증을 주장하지 않는다. 상세 대응은 `docs/KRDS_COMPONENT_MAPPING.md`. 기존 앱 및 첨부 지시서가 시각·기능 계약이며 새 이미지 생성/외부 런타임 의존성은 추가하지 않는다.
