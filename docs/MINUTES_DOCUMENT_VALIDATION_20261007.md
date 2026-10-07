# 읽기 중심 회의록 검증

사용자 요청: 첨부한 A. Note 예시처럼 제목, 논의 주제, 글머리표와 여백으로 회의록을 읽을 수 있게 한다. Stream-Record의 디자인과 원문 근거 확인은 유지한다.

## 변경

- 기본 화면은 회의록 문서 보기, 직접 수정은 기존 Markdown 입력창이다. 보기 전환은 저장 문자열을 바꾸지 않는다.
- 기존 다섯 열 근거 표는 내용·실제 담당자/기한·근거 번호의 목록으로 표시한다. 근거 인용과 전체 근거 목록은 기본으로 접는다.
- 새 생성 결과는 주제 제목과 글머리표, 실제 구간 시작 시각, 확인된 결정·제안·조치·수치·미결 사항의 목록이다. 비어 있는 항목을 반복 표시하지 않는다. 자료에 없는 회의 날짜나 참여자를 채우지 않는다.
- 저장 Markdown에는 모든 검증된 사실과 원문 인용·내부 ID를 유지한다. 번호는 화면에서 받아쓰기-N으로 표시하고 기존 원문 이동과 없는 ID 오류를 사용한다.
- JSON 응답 형식, 인용·수치·담당자 검증, 생성 예산과 실패/취소 시 저장 흐름을 유지한다. 프롬프트 변경으로 전체/묶음 체크포인트 해시 정책은 모두 5로 변경한다.
- HTML·외부 이미지·외부 링크는 문서에서 실행하지 않는다. 기존 react-markdown/remark-gfm과 제주 토큰을 사용한다. 본문 스크롤은 main이 소유한다.

## 검증 결과

| 범위 | 결과 | 근거 |
|---|---|---|
| 원문·근거·체크포인트 및 문서 생성 | 69 통과, 0 실패 | app/frontend/test-results/minutes-core.log |
| React 상태·편집·생성 실패·저장 회귀 | 79 통과, 0 실패 | app/frontend/test-results/minutes-ui.log |
| TypeScript | 통과 | app/frontend/test-results/minutes-types.log |
| 생산용 정적 화면 빌드 | 통과 | app/frontend/test-results/minutes-build.log |
| Rust 회의록 요청 스키마·예산 | 5 통과, 0 실패 | 작업 공간 outputs/minutes-native.log, minutes-native-result.json |
| 실제 Chrome 문서·편집·원문 펼침·근거 이동·저장·실패·빈 상태 | 14개 시나리오 통과 | app/frontend/test-results/minutes-browser/qa.json |
| 1920/1280/768/375px, 100/112.5/125% 글자 크기 | 가로 넘침 없음, axe WCAG A/AA 위반 0 | qa.json과 동일 폴더의 10개 PNG |
| React Doctor 두 변경 컴포넌트 | 오류 없음, 경고 3개 | app/frontend/test-results/minutes-react-doctor.json |

React Doctor 경고는 읽기 전용 근거 목록의 위치 key, 기존 생성 패널의 제어 흐름 복잡도, 라우팅용 #ai 링크의 정적 대상 검출이다. 원문 이동·문서 편집·저장·오류 화면은 별도로 실제 브라우저에서 실행했다. 경고를 숨기는 설정은 추가하지 않았다.

브라우저 시험은 격리된 합성 기록과 모의 Tauri 응답을 사용하는 실제 생산용 화면이다. 실제 모델의 요약 정확도, 설치된 WebView, 랩탑·설치 교체·GitLab 배포를 검증했다고 주장하지 않는다. 이번 요청에는 설치·배포가 포함되지 않는다. 실제 사용자 기록·설정·음성·설치 폴더는 바꾸지 않았다.

화면 자료: minutes-desktop.png, minutes-generated-desktop.png, minutes-1920-100.png, minutes-1280-125.png, minutes-768-112.5.png, minutes-375-125.png, minutes-quote.png, minutes-editor.png, minutes-failure.png, minutes-empty.png. quote 캡처는 펼친 상태 표시는 보이나 인용 본문이 화면 아래에 있어, 내용 확인 근거는 브라우저 시나리오의 표시 검증과 컴포넌트 소스다. 키보드 초점 이동은 실제 근거 이동 시 activeElement로 확인했다. Windows 화면 낭독기·실제 DPI 확대 시험은 수행하지 않았다.

## 최종 검토

- 디자인·기능 무결성 독립 검토: PASS / APPROVE, 차단 사항 없음. 회의록 DOM·토큰·원문/근거 보존·정책 버전 검토 및 핵심/React 테스트를 독립 재실행했다.
- 화면·한국어 가독성 독립 검토: PASS / APPROVE, 차단 사항 없음. 10개 실제 화면 캡처와 사용자 참고 이미지 2개를 모두 열어 비교했다.
- 자료는 작업 공간 `.omo/evidence/minutes-document-clone-fidelity.md`, `.omo/evidence/minutes-document-visual-gate-review.md`에 있다. 참고 화면과 같은 앱 전체를 복제한 결과가 아니라, 기존 Stream-Record 디자인 안에서 문서의 정보 계층과 가독성을 개선한 결과다.
