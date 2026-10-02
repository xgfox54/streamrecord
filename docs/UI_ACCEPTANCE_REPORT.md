# v0.6.3 AI 보정·요약 회귀 검증 (2026-10-02)

- 숫자·길이 보호 실패를 구간별 원문과 확인 사유로 보관하고 후속 구간 처리를 계속한다. 같은 입력의 자동 재요청을 막고 명시적 재시도를 제공한다.
- 실시간 요약은 수동 검토본, 유효한 AI 보정본, 최초 원문 순서로 사용한다. 입력 변경 시 이전 체크포인트와 늦은 응답을 무효화한다. 빨간 확인 문장은 완결된 문장으로 표시하고 저장 요약 원본은 유지한다.
- 자동 검사: 패키징 254건 통과/실패 0. React 42, 핵심 52, 요약 표시 11, TypeScript·Rust CUDA 검사와 동봉 Whisper 실제 오프라인 적재·CUDA 추론 포함.
- 실제 프로덕션 Chrome: 375/768/1280px, 34캡처. 1구간 숫자 변경 거절 후 36구간 계속 처리, 명시적 재시도, 원문·저장 요약 보존과 좁은 화면 빨간 완결 문장 확인. 이 경로의 native·AI는 대역이며 실제 계정 검사와 구분한다. 독립 검토 2건 PASS, 34/34캡처 확인.
- 실제 새 설치본: Windows UI에서 버전 0.6.3 확인. 실제 ChatGPT OAuth gpt-5.6-luna로 기존 사용자 영상 테스트 기록을 29/37 → 36/37 보정. 숫자가 바뀐 31번 구간은 원문·확인 사유 유지, 이후 구간 보정 완료. 새 누적 요약의 체크포인트 해시가 보정본 입력과 일치하며 공천위원장·연석회의 반영 확인.
- 최초 원문 37구간·수동 검토·음성 식별자 및 다른 94/7구간 기록과 빈 기록 2개 보존. 자동 보정·요약은 검사 후 기존 꺼짐 설정으로 복원. YouTube 프레임과 기존 빨간 확인 문장의 완결 표시도 native 화면 확인.
- 이번 회귀는 기존 영상 녹음 기록을 사용했다. 새 장치 녹음·전체 영상 정확도·한국어 다화자 DER·모든 외부 공급자 실계정 검증은 NOT_RUN이다. GitLab·Drive 게시 상태와 혼동하지 않는다.

증거: `outputs/ui-correction-v063/browser/qa.json`, `.omo/evidence/v063-final-integrity.md`, `.omo/evidence/v063-final-pixels.md`, `outputs/ui-correction-v063/native/installed-ui-evidence.json`, `outputs/korean-bundled-0.6.3/package-result.json`, `installation-result.json`. 설치파일·게시 단계는 V063_VALIDATION.md 및 단계별 영수증으로 확인한다.

---

# v0.6.0 보안 재빌드 UI 검증 (2026-10-01)

Next.js 16.3.6, jsonwebtoken 10.3.0 기준 새 빌드의 화면 결과다. 이전 후보 검증은 별도 이력으로 보관했다.

- 브라우저: 17시나리오/115캡처, 375/768/1280px. 접근성 위반0, JavaScript 오류0.
- 두 독립 검토 PASS(높은 신뢰도). manifest SHA256: 5e3231919640a706c262a20b322f21c70f63a36416fbe65d05a83f95f767a6ed.
- 화면 소스232/native identity196/compiled66 및 캡처115의 해시를 대조했다. 빌드 이후 소스 변경과 빌드 이전 캡처가 없다.
- 자동 검사: frontend51, React 상태32, 배포정책27, native stream_record_52, 연결18, 화자4, 복구13, 내장생성 제한2 통과. 동봉 Whisper 오프라인 적재와 실제 CUDA 추론도 통과했다.
- 실제 새 네이티브 설치본: 버전0.6.0, Stereo Mix 58초 세션/5구간, 저장 음성 화자1명/5구간, ChatGPT 회의록890자·누적 요약5회·보정5/5, YouTube 원문/보정본/병기, 재시작 및 기존94구간 복원 PASS. 상세와 해시는 V060_VALIDATION.md 및 NATIVE_QA_VERIFICATION.json. 브라우저 fixture와 별도 검증이다.

최종 설치본 및 게시 상태는 V060_VALIDATION.md와 단계별 영수증을 참조한다. 아래 과거 버전의 결과는 해당 시점에만 적용한다.

---

# Stream-Record v0.5.3 UI 수용 검사

작성일: 2026-09-30. 아래 결과는 적힌 시험 범위에 한정한다. 배포 성공 여부는 별도 원격 게시 검증으로 확인한다.


## 구현
- 로컬 Whisper 확정 원문 뒤 연결된 AI가 문장 단위 보정. `text`, `reviewed_text`, `ai_correction`은 별도 보관한다.
- 자동 보정은 전송 위치를 보고 사용자가 켠다. 확정 전 입력은 보내지 않는다. 기존 대화와 새 확정 문장을 처리한다.
- 원문/보정본 전환, 원문 동시 보기, 전체 검색, 200구간 페이지, 별도 TXT 저장. 녹음 설정은 상단 접기, 넓은 읽기 화면, 기본 창 1440×960.
- 세션/모델/용어 변경 또는 해제 뒤의 늦은 응답 무시, 입력 신원 대조, 숫자 변경/빈 응답/누락된 ID/과도한 축약 거절. 모든 생성 요청 직렬화.
- 설치 기본 한국어 Whisper와 원본 아이콘, 기존 계정 연결/저장 식별자 유지. 요약 모델 추가 자동 다운로드 없음.

## 소스 및 UI 검증
- 핵심 회귀 47/47, React 경계/화면 상태 30/30, TypeScript 및 Next production build 통과.
- 실제 Chromium 206개 합성 구간: 원문/보정본/비교/검색/페이지/부분 문장/오류 재시도 통과.
- 375/768/1280/1440, 작은 창 옵션 펼침과 오류 상태: 가로 넘침 없음, axe 위반 없음.
- Jeju 7개 메뉴와 상태 회귀, 명암 대비 16쌍 통과. 두 독립 검토 PASS/APPROVE.
- 실제 설치된 Ollama gemma4:e2b-it-qat: 합성 한국어 2문장 보정 6.304초, 3000 수치 및 원문 유지. 이 검증 자체는 Tauri IPC가 아닌 HTTP+실제 frontend parser 범위다.
- 206개 즉시 응답에서 발생한 React 최대 업데이트 깊이 오류를 3초 간격 배치로 수정 후 재검증. 스크롤 읽기 영역에 키보드 초점 제공.
- LSP 도구는 호출 작업 경로 밖 저장소 제한으로 실행 불가. 대신 실제 저장소 TypeScript 컴파일 검증 통과.

## 설치 및 실제 실행
- 패키징 검증 138건 통과, 실패 0. Rust 30개, 오프라인 모델 적재, CUDA 실제 전사 포함. 승인된 18.686초 음성 0.872초 처리(RTF 0.0467)는 단일 속도 시험이며 정확도 벤치마크는 아니다.
- NSIS CRC/SHA-256/동봉 모델/소스 575항목 일치 검증 통과. 한국어 small-q5_1 모델 190,085,487 bytes 포함. 설치 시 추가 모델 다운로드 없음.
- 기존 0.5.2 설치 폴더와 현재 세션/DB 백업 후 0.5.3 설치. 실행파일 및 모델 해시가 패키징 결과와 일치.
- 실제 설치본을 Windows 사용자 세션 3에서 UI로 조작. Stereo Mix에서 승인된 12.630초 WAV만 재생·녹음. 중지 전 원문 3구간 표시, 중지 후 3구간 저장 성공. 주변 마이크 사용 안 함.
- 실제 설치본 Tauri IPC → 로컬 Ollama gemma4:e2b-it-qat → frontend 검증 → 자동 저장 경로로 3/3 보정 완료. 이 음성의 인식 문장은 이미 자연스러워 보정 결과가 동일했다. 오타가 포함된 별도 합성 문장 2개의 실제 모델 수정 성공은 앞선 HTTP 시험 범위로 구분한다.
- 최초 원문과 수동 검토 내용 동일성 검사 통과. 원문/보정본 전환, 원문 함께 보기, 별도 TXT 저장 파일 내용 확인.
- 실제 앱 정상 종료·재실행 뒤 AI 보정됨 3구간 복구 확인. 자동 보정은 재시작 후 꺼짐. 기존 선택 gpt-6-sol 복원.
- 시험 완료 뒤 사용자 기존 세션 복원: 88구간과 4,672자 회의록 포함 전체 JSON 데이터가 백업과 동일. 앱의 JSON 재직렬화로 파일 바이트 해시는 달라질 수 있으므로 데이터 구조 동등성으로 검증.
- 다른 앱 음소거 및 마스터 음량을 시험 전 상태(40%)로 복원한 보고서 확인. 디버그 포트 없이 Windows UI로 시험.
- 현재 설치본 실행 중. GitLab/Drive 게시 결과와 혼동하지 않는다.

증거: outputs/korean-bundled-0.5.3의 package-result.json, installation-result.json, native-raw-result.json, native-corrected-result.json, native-export-result.json, native-restart-result.json, native-restored-result.json, audio-isolation.json, native-correction-screen.jpg.

설치파일: `Stream-Record-0.5.3-korean-bundled-windows-x64-setup.exe`

크기: 522006852 bytes. SHA-256: 3fb66c89251a58fc5acff1f0541c9bddaf25c94171929ebb378a617314abe133.

## 범위 제한
AI는 원음을 직접 검증하지 않으므로 모든 오인식을 확실히 복원한다고 주장하지 않는다. 실제 화자 분리 기능 추가 아님. 이번 변경으로 외부 개인 구독 공급자 전체, 장시간 회의 또는 10분 YouTube 재검증을 했다고 주장하지 않는다. 이 문서는 구현·설치 검증 기록이다. GitLab/Google Drive 게시 여부는 별도 배포 결과와 원격 자산으로 확인한다.


실제 주변 마이크, 3시간 장시간 녹음, Windows 화면 낭독기·고대비·실제 DPI 배율 전체 검사는 NOT_RUN이다. 설치파일은 미서명이다. 기존 데이터 경로와 MIT 원저작권을 보존한다.
