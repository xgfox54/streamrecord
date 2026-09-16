# stream-record Design System

## 1. Atmosphere & Identity

차분한 업무용 기록 도구다. 장식보다 녹음 방식, 현재 상태, 전사 원문과 회의록의 구분을 우선하며 청록색 기본 동작과 붉은 중지 상태가 핵심 신호다.

## 2. Color

| Role | Value | Usage |
|---|---:|---|
| Page surface | `#f4f7fb` | 작업실 배경 |
| Panel surface | `#ffffff` | 설정과 결과 패널 |
| Text primary | `#172c42` | 제목과 본문 |
| Text secondary | `#526579` | 설명과 보조 정보 |
| Accent | `#145c68` | 주요 녹음·생성 동작 |
| Accent hover | `#0e4b56` | 주요 동작 hover |
| Focus | `#69aeb7` | 키보드 focus ring |
| Border | `#dce4ec` | 패널과 입력 경계 |
| Stop/error | `#a3243e` | 중지 동작과 오류 |

새 색상은 의미 역할이 생길 때만 이 표에 먼저 추가한다.

## 3. Typography

- Primary: `system-ui, -apple-system, Malgun Gothic, sans-serif`
- Mono: `ui-monospace, monospace`
- Page title: 30px, 750
- Section title: 17px, 700
- Transcript: 15px, line-height 1.85
- Body: 14px, line-height 1.6
- Caption and labels: 11–12px

## 4. Spacing & Layout

- 4px 단위를 기본으로 하며 8, 12, 20, 28px 순서로 밀도를 조절한다.
- 1050px 초과에서는 전사와 회의록을 2열로, 이하에서는 1열로 표시한다.
- 작업실 문서가 세로 스크롤을 소유하고 전사 패널은 긴 원문의 내부 스크롤을 소유한다.
- 입력과 패널은 `min-width: 0`, 긴 경로와 발언은 `overflow-wrap: anywhere`로 가로 넘침을 막는다.

## 5. Components

### Action Button

- Variants: 기본, primary, stop
- States: default, hover, focus-visible, disabled
- Accessibility: 네이티브 `button`, 3px focus ring, 상태에 맞는 disabled 사용

### Recording Controls

- Structure: 제목, 마이크 선택, 장치·모델 설정, 유튜브 링크, 동의, 동작 버튼
- Recording variants: `외부 소리 녹음 (마이크)`, `PC 소리 녹음 (Stereo Mix)`
- Safety: 각 동작은 명시한 입력 장치 하나만 사용하고 자동 대체하지 않는다.
- Empty/error: Stereo Mix가 없으면 안내 문구와 해당 버튼 disabled로 표시한다.

### Result Panel

- Variants: 실시간 전사, 편집 가능한 회의록
- Layout: 넓은 화면 2열, 좁은 화면 1열
- States: empty, live, busy, error, populated

## 6. Motion & Interaction

장식 애니메이션은 사용하지 않는다. hover와 focus는 조작 가능성을 알리는 데만 쓰며 `prefers-reduced-motion`에서는 자동 스크롤 동작을 즉시 처리한다.

## 7. Depth & Surface

전략은 borders-only다. 흰 패널과 얇은 청회색 경계로 계층을 구분하며 그림자는 사용하지 않는다.

## 8. Accessibility Constraints & Accepted Debt

- 목표: WCAG 2.2 AA, 키보드 접근, 명시적 label, 상태·오류의 ARIA 역할, 한국어 자연 줄바꿈.
- 녹음 중 창 닫기를 차단해 저장 중인 발언이 유실되지 않게 한다.
- Accepted debt: 실제 화면 낭독기 순회와 고대비 Windows 모드는 이번 릴리스에서 물리 검증하지 못했으며 후속 접근성 점검 대상이다.
