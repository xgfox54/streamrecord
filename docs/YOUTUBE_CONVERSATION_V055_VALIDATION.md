# v0.5.5 YouTube 전체 대화

## 구현
YoutubeView의 LiveTranscriptPanel import와 렌더링을 기존 DictationConversation으로 교체했다. 새 보정 컨트롤러, 별도 상태 저장소, CSS 또는 의존성은 만들지 않았다.

받아쓰기와 동일하게 전체 대화/구간 수, 확정 문장 자동 보정, 상태 및 AI 설정, 실시간 원문/AI 보정본, 원문 함께 보기, 검색, 200구간 페이지, 최신 문장, 별도 TXT 저장을 제공한다. 영상 준비/iframe/녹음 시작·중지/요약은 유지한다.

## 진행 검증
- 기존 v0.5.4 production 화면에서 YouTube 전체 대화 영역이 없어 새 브라우저 시나리오가 예상한 위치에서 실패하는 것을 확인했다. outputs/youtube-conversation/baseline-failure.log.
- 프런트엔드 47개, React 세션30개, 배포도구27개, Rust30개 및 TypeScript 검사 결과는 패키지 로그로 확인한다.
- Production Chrome 45개 최신 화면 캡처와 동작 검증 통과. 205확정+1부분 문장, 원문/보정본 전환, 원문 비교, 전체 검색/페이지, 별도 TXT 내용, 실시간 이벤트, 메뉴 간 보정 상태 공유와 iframe 유지, 보정 실패/재시도/중지 확인. 경계는 시뮬레이션.
- 변경된 YouTube/전체 대화 화면은 독립 기능/화면/픽셀/코드 검토에서 차단 사항 없음. 기존 전체 전사 화면 768px 안내문에서 “들을 수 / 있습니다” 줄바꿈이 관찰돼 전체 앱의 엄격한 한글 배치 검토는 통과로 주장하지 않는다. 요청과 무관한 기존 안내 문구는 수정하지 않았다.
- 패키지 검증138통과·실패0. 설치파일522,145,970bytes, SHA256 cdcb69c23a91ee5c25fd26fec99f4d8991e2581e892fdaa70d2f11e3dce025c4.
- 설치 교체 완료: 기존 앱을 정상 종료하고 앱·사용자 데이터 백업 후 v0.5.5 설치. 설치 실행파일 SHA256 1680547e2f92c0d7131bd18034d69cb1d35930c1d398d1898dd010e1731f81b9. 한국어 동봉 모델 SHA256 ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb 일치.
- 설치본 직접 검증: YouTube 전체 대화94구간 표시, 실시간 원문 → AI 보정본 전환, 원문 함께 보기 체크 및 비교 문장 표시 확인. 기존 원문94개와 AI 보정94개 모두 동일하게 보존. 저장 과정에서 객체 속성 순서와 두 audio_end_time의 1e-12초 미만 부동소수점 표현만 달라졌으며 그 외 값은 동일. outputs/youtube-conversation/native-qa.json 및 outputs/korean-bundled-0.5.5/installation-result.json 참조.

## 범위
브라우저 시나리오는 실제 Chrome 렌더링, 합성 전사와 시뮬레이션 native/AI/YouTube 경계를 사용한다. 실제 설치본 화면 점검과 분리해 기록한다. 새 장치 녹음, 외부 제공자 추론 및 장시간 재생은 이번 컴포넌트 재사용 변경의 검증 완료 항목이 아니다.
GitLab/Google Drive에는 이번 버전을 아직 게시하지 않았다.
