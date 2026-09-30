# Stream-Record Design System

## 2026-09-30 Jeju 적용 계약 (아래 기존 값보다 우선)
사용자가 지정한 Jeju Style UI·UX v0.6.0, SHA `3fe4fc321dabb03f3fff42c06e2b9004636b8c0f`를 따른다. `app/frontend/src/styles/jeju-tokens.css`는 정본의 수정 없는 사본이다. 기존 `--sr-*`는 정본 `--jeju-*`의 역할별 별칭으로 연결하며 새 색 리터럴을 추가하지 않는다. public 프로필의 본문 17px, 기본 조작 48px, 최소 터치 44px, 패널 radius-lg, 흰 표면/중립 바탕을 사용한다. 사용자 확대 설정은 별칭의 글자 크기를 rem으로 변환해 유지한다. 외부 폰트 요청 없이 정본 글꼴 체인의 로컬 대체 글꼴을 사용한다.

대상 사용자는 처음 녹음하는 사용자, 전사문을 원음과 대조하는 검토자, 키보드/확대 사용자다. 첫 화면의 질문은 “어떤 소리를 기록할까요?”이며 입력 선택 → 녹음 → 결과 확인을 안내한다. 마이크/PC 소리의 구체적 용도를 표시하고, 동봉 음성 모델을 별도 설정 없이 사용한다. 필수 항목과 고급 설정을 분리한다. 녹음 준비와 실시간 전사를 데스크톱에서 나란히, 작은 화면에서는 준비→전사 순으로 둔다. 상태와 중지는 헤더에서 항상 접근한다.

재사용 요소: WorkflowSteps(현재 단계 문구), SessionProgress(실제 타이머와 구간 수), RecordingPreparation(입력/동의/시작), Jeju 상태 배지와 알림, LiveTranscriptPanel(빈/진행/완료), TranscriptReviewHints(반복 가능성, 원음 연결). 각 요소는 기본/초점/비활성/오류 상태를 갖는다. 아이콘은 정본 Jeju SVG를 우선 사용하며 녹음·미디어 고유 아이콘은 기존 Lucide를 유지한다. 색상 의미는 파랑=행동/선택, 초록=완료, 주황=진행/확인 필요다. 장식 효과나 정부 인증 표식은 넣지 않는다.

YouTube 플레이어는 탭 이동 시 동일 iframe을 유지한다. 시작 순서는 링크 확인 → 권한 확인 및 녹음 시작 → 플레이어 재생이다. 다른 PC 소리도 함께 녹음되는 Stereo Mix의 성격을 간단히 안내한다. 요약 모델 연결은 선택 사항이며 녹음을 막지 않는다.

반복 검토 표시는 동일한 문장을 인접 시간에 인식했을 때만 제안한다. 원문은 삭제·합치기·자동 교정하지 않는다. 원음 연결 동작을 검토 화면에 직접 노출한다. 실제 발화와 대조하지 않은 표현을 정답으로 바꾸지 않는다.

접근성: 375/768/1280px 화면, 가로 넘침, 보이는 label, 키보드 초점, 125% 확대, forced-colors/reduced-motion을 확인한다. 인쇄 시 메뉴와 조작을 빼고 결과를 펼친다. 실제 화면낭독기와 한국어 정확도 정량 평가는 별도 미검증으로 기록한다. 앱 셸 특유의 스크롤은 원문 읽기 위치와 영상 재생을 보존한다. 색·타이포·간격 정본 변경은 참조 SHA와 함께 기록한다.

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

## v0.5.3 받아쓰기 읽기 계약 (2026-09-30)
에이닷 공유 노트 `https://adot.ai/note-share/roDIHBlv`의 실제 받아쓰기 화면을 확인했다. 얕은 제목/탭 아래 시간순 대화 문단을 넓게 읽는 구조가 참고 대상이며, 색·글꼴·아이콘은 기존 Jeju 정본을 유지한다. 에이닷의 화자 추정·상표·본문을 복제하지 않는다.
받아쓰기 준비는 상단 한 줄의 상태·시작/중지와 접는 녹음 옵션으로 축소한다. 읽기 영역은 본문 폭 전체와 최소 30rem/화면 높이 60vh를 사용하며 본문 1.1875rem, 줄간격 1.85로 표시한다. 200구간씩 시간순 표시하고 앞/뒤 페이지 및 전체 검색으로 모든 대화에 접근한다. 최신 이동은 명시적 버튼. 창 기본 크기는 1440×960이고 작은 화면에서는 조작을 세로로 접는다.
실시간 원문과 AI 보정본은 aria-pressed 토글로 전환한다. 보정본 없는 구간은 원문과 대기 표시를 함께 제공한다. AI 보정은 사용자 활성화 후 연결 모델로 확정 구간만 처리하며, 요청/완료/대기/오류/일시정지 상태를 구별한다. 원문과 사람이 편집한 검토본은 보존하고 AI 결과를 별도 저장한다. 원문 펼치기와 보정본 TXT/원문 TXT를 구분한다. AI 수정은 원음 검증이 아니므로 보정본에 확인 필요 문구를 표시한다.

Reader role aliases live in `workspace.module.css`: `--sr-type-reader` (19px at default scale), `--sr-line-reader` (1.85), `--sr-reader-height` (60vh), and `--sr-reader-min` (30rem). The narrow reader uses the existing body type role and CSS pretty wrapping to avoid a lone predicate where supported. Borders and focus consume the existing shared width aliases. Expanded recording options are verified at 375px and 768px alongside the correction error state.
