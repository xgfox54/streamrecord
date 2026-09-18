# KRDS 컴포넌트 대응표

확인일: 2026-09-17. 공식 사이트의 가이드 내용을 참조한 **확장형 자체 구현**이다. 공식 KRDS 배포 패키지·jQuery DOM 스크립트를 추가하지 않았으며, KRDS 인증을 의미하지 않는다. 기준은 첨부 지시서와 DESIGN.md다.

| 공식 참고 | 적용 규칙 | 구현 |
|---|---|---|
| [버튼](https://www.krds.go.kr/html/site/component/component_05_02.html) | 화면별 주요 행동 하나, native button, 48px 높이, 명시적 상태·초점 | workspace.module.css, RecordingView, MinutesView |
| [타이포그래피](https://www.krds.go.kr/html/site/style/style_03.html) | 17px 상당 rem 본문, 1.6 줄간격, 확대 설정, 외부 폰트 없음 | workspace.module.css, SettingsView |
| [색상](https://www.krds.go.kr/html/site/style/style_02.html) | 원색과 의미색 분리, 주황·초록 위 짙은 글자 | workspace.module.css scoped --sr-* |
| [레이아웃](https://www.krds.go.kr/html/site/style/style_05.html) | 4px 간격 배수, 900/600px 반응형, 긴 내용 줄바꿈 | AppShell, workspace.module.css |
| [디스클로저](https://www.krds.go.kr/html/site/component/component_04_04.html) | 원음 도구·상세 설정·라이선스 펼침 | RecordingView, TranscriptView, SettingsView |
| [모달](https://www.krds.go.kr/html/site/component/component_04_05.html) | 제목·설명, 초점 가두기·복귀, Escape·계속 사용 | SessionDialog (기존 Radix Dialog) |
| [확인](https://www.krds.go.kr/html/site/global/global_11.html) | 녹음 중지·저장 후 종료의 결과 명시 | KoreanWorkspace, useMeetingSession |
| [구조화 목록](https://www.krds.go.kr/html/site/component/component_04_01.html) | 구간 ID·시간·원문·검토본·도구 구분 | TranscriptView |
| [선명한 화면](https://www.krds.go.kr/html/site/style/style_09.html) | forced-colors에서 시스템 색과 경계 유지 | workspace.module.css |

버튼·타이포그래피 페이지는 이번 구현 중 직접 조회했다. 나머지 링크는 첨부 지시서의 공식 참고 위치이며 개별 페이지의 최신 규칙 전체 재검증을 뜻하지 않는다.

탐색은 탭 위젯이 아닌 실제 hash 링크다. 브라우저 뒤로/앞으로 이동을 지원하며 화면 제목으로 초점을 이동한다. 기존 세션 hook은 한 번 mount되어 화면 이동으로 네이티브 리스너나 타이머를 다시 등록하지 않는다. 음성 원본·모델·저장 경로와 ko_* 명령 입력은 유지한다.

실행 검증·대비 계산·수동 키보드·설치본 검증 결과는 `UI_ACCEPTANCE_REPORT.md`에서 각 결과를 분리한다. 이 대응표는 구현 규칙이며 검증 통과 증거를 대신하지 않는다.
