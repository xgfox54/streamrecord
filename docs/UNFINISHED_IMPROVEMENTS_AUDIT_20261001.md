# Stream-Record 미완료 개선사항 검토

검토일: 2026-10-01 KST. 기준 소스/설치본 v0.5.5. 소스 수정, 신규 녹음, 새 모델 추론, 빌드, 설치 및 배포는 수행하지 않았다. 인계 요구와 활성 코드, 저장된 검증 증거를 대조한 감사이며 전체 앱의 런타임·보안 승인 판정이 아니다.

## 기준과 한계

- 소스: `C:/Users/Public/Documents/ESTsoft/CreatorTemp/streamrecord-v0.5.0-candidate/work/publish-v0.5.0-1790639934680/app`.
- Git HEAD: `aea7ce1f0fd131f55679933913ffce906b4c83a4`. 작업 트리에 후속 버전 변경이 있어 HEAD만으로 검토 대상을 재현할 수 없다. 주요 파일 SHA-256은 `outputs/unfinished-audit-20261001/source-binding.json`에 기록했다.
- 현재 설치 실행파일을 다시 해시한 결과 v0.5.5 installation-result와 일치: `1680547e2f92c0d7131bd18034d69cb1d35930c1d398d1898dd010e1731f81b9`.
- 인계 자료: `C:/Users/Rumans/Documents/Codex/2026-09-17/stream-record-krds-uiux-md-assets/work/v050-handoff/extracted/streamrecord-wp1-20260928` (이하 HANDOFF).
- rev2 작업지시서 원문 `StreamRecord_GTX1660Ti_Improvement_Work_Order_20260927_rev2_JejuGlossary.md`는 로컬 인계 자료와 Downloads 검색에서 찾지 못했다. 지정 Google Drive 폴더를 새로 읽고 정확한 이름 및 GTX1660 관련 검색도 수행했으나 원문을 찾지 못했다. 검색 범위 내 미발견이며 파일이 어디에도 없다는 증명은 아니다. 원문 전체 요구 충족은 확정할 수 없다.
- 과거 NOT_RUN/BLOCKED를 그대로 복사하지 않고 이후 완료 근거가 있으면 제외했다. 사전 설계 문서의 모든 제안이 사용자 필수 요구와 같은 것은 아니다.

## 미구현 또는 연결이 끊긴 기능

| ID | 항목 | 현재 상태와 사용자 영향 | 근거 |
|---|---|---|---|
| F1 | Nemotron 3 Diarization 화자분리 | 엔진·화자 ID·귀속 UI 미구현. S번호는 전사 구간 번호다. | HANDOFF/docs/DIARIZATION_AND_REVIEW.md:5; app/frontend/src/components/stream-record/TranscriptView.tsx:23; DictationConversation.tsx:24 |
| F2 | 제주도의회 공식 회의록 기반 용어 사전팩 | 공식 수집기, 출처/검수 이력, 배포 사전팩, G0/G1/G2 평가 미완료. 수동 용어 입력과 이전 문맥 힌트는 이미 구현돼 있다. | HANDOFF/docs/JEJU_COUNCIL_GLOSSARY.md:9; docs/V0.5.0_COMPARISON_AND_VALIDATION.md:56; app/frontend/src-tauri/src/whisper_engine/stt_context.rs:44 |
| F3 | 대체 STT 엔진 비교·선정 | Nemotron 3.5 ASR, faster-whisper large-v3-turbo 후보 연동과 동일 음원·장비 비교가 진행되지 않음. 화자분리 모델과 별개 작업이며 무조건 Whisper를 교체하라는 뜻은 아니다. | HANDOFF/docs/STT_ENGINE_SELECTION.md:12; app/frontend/src-tauri/src/audio/transcription/engine.rs:15 |
| F4 | 선택 다운로드한 내장 요약 모델의 실제 사용 | 다운로드 UI는 있지만 주화면의 모델 목록/생성 경로는 Ollama와 호환 프록시만 지원. 내장 모델을 내려받아도 현재 회의록·실시간 요약·AI 보정에 연결되지 않는다. 별도 Ollama에 설치한 모델은 사용 가능하다. | AiConnectionsView.tsx:47; app/frontend/src/components/BuiltInModelManager.tsx:201; meeting_ko.rs:499; meeting_ko/generation.rs:51 |
| F5 | 앱 독립 구독 계정 연결 | GPT·Claude·Antigravity 직접 로그인 어댑터 없음. OpenCodex/호환 서버를 선택 연결하는 경로는 구현됨. 사용자 요구의 독립 계정 연결과 선택 API 연결을 혼동하면 안 된다. | AiConnectionsView.tsx:48,50; README.md:59; docs/AI_CONNECTIONS_AND_BUNDLED_MODEL_DESIGN.md |
| F6 | 공급자별 API/설정 통합 | 활성 외부 요청은 OpenAI 호환 /models 및 /chat/completions + Bearer만 지원. 각 서비스 API 키를 쓰면 된다는 안내는 범위가 과도하다. 설정 화면의 기존 Claude 등 공급자 설정은 주화면 ko_models와 별도여서 통합되지 않는다. | AiConnectionsView.tsx:50; meeting_ko/generation.rs:171; meeting_ko.rs:535; app/frontend/src/components/SummaryModelSettings.tsx:104; useMeetingSession.ts:71 |
| F7 | 전체 회의 누적 실시간 요약 | 현재는 최근 5,600자를 전달하고 한 개 요약을 덮어쓴다. 화면의 '현재까지의 요약'을 전체 회의 누적 요약으로 해석하면 범위가 맞지 않는다. 종료 후 전체 회의록 생성은 별도 구간 처리로 구현돼 있다. | useMeetingSession.ts:118; LiveSummaryPanel.tsx:9; meeting-ko/structured-minutes.ts:55 |
| F8 | 강제 종료 후 미처리 녹음 자동 이어하기 | 디스크 queue 보존은 있으나 PID·시각별 새 spool만 생성하고 이전 spool 자동 재부착 경로가 없다. 정상 종료 복원과 저장 음성의 수동 재전사 이어하기는 구현됨. | app/frontend/src-tauri/src/audio/transcription/queue.rs:43,197; HANDOFF/docs/RECOVERY_AND_DATA_COMPATIBILITY.md:17; README.md:47 |

위 표의 경로 약칭: `AiConnectionsView.tsx`, `MinutesView.tsx`, `useMeetingSession.ts`, `LiveSummaryPanel.tsx`, `DictationConversation.tsx`는 `app/frontend/src/components/stream-record/` 아래다. `meeting_ko.rs`와 `meeting_ko/generation.rs`는 `app/frontend/src-tauri/src/` 아래다.

## 연결 안내 및 설계 대비 데이터 보호 미완료

| ID | 항목 | 소스 확인 결과 | 근거 |
|---|---|---|---|
| D1 | 실제 전송 주소 표시 | 사용자가 다른 API 주소를 저장해도 회의록 화면은 항상 127.0.0.1:10100/v1을 표시한다. 실제 요청은 저장된 주소로 나간다. | MinutesView.tsx:8; meeting_ko/generation.rs:171 |
| D2 | 인증 키 보안 저장소 | 설계는 Credential Manager/사용자 DPAPI를 요구하지만 실제 저장은 tauri_plugin_store의 stream_record_proxy.json apiKey 값이다. OS 보안 저장소 연결이 없다. 실제 키 파일은 읽지 않았고 유출을 주장하지 않는다. | docs/AI_CONNECTIONS_AND_BUNDLED_MODEL_DESIGN.md:110; meeting_ko.rs:90; app/frontend/src-tauri/src/lib.rs:460 |
| D3 | 외부 HTTP·URL 자격정보 제한 | 설계의 loopback 외 HTTP 제한·URL 자격정보 금지와 달리 검증은 HTTP(S) 접두사, 길이, 공백뿐이다. 연결 경계 보강 필요. 리다이렉트 차단은 이미 구현돼 있다. | 설계문서:116; meeting_ko.rs:54,153 |

## 구현과 구분할 미검증 항목

1. 정답 한국어 corpus 기반 CER/WER·중요정보 오류·제주 용어 정확도와 후보 엔진 비교. 단일 CUDA RTF/VRAM 측정은 이미 있으나 정확도 개선 근거가 아니다.
2. 60분/3시간 실제 녹음의 메모리·대기열 지연·누락·최종 저장 안정성. 3시간 샘플 시계 테스트는 시뮬레이션이다.
3. VAD 고정 창 경계의 발언 누락·반복 원인 검증. 반복 의심 표시 UI를 추가했지만 STT 원인을 해소했다고 검증한 것은 아니다.
4. 실제 강제 종료·전원 단절·디스크 고갈·장치 이탈 후 복구. 정상 종료 후 세션 복원 PASS와 다르다.
5. 외부 공급자별 인증 만료·한도·실제 응답 및 실시간 요약/회의록의 내용 품질. 모델 목록 조회와 로컬 문장 보정 성공을 대신 사용할 수 없다.
6. 최신 v0.5.5에서 새 장치 녹음·외부 추론·10분 영상 녹음 재시험. v0.5.1의 실제 10분 성공은 존재하며 '10분 시험 자체 없음'이 아니다.
7. Windows 화면 낭독기·실제 DPI·고대비의 전체 흐름. 브라우저 axe/125%/forced-colors 완료와 구분한다.

근거: docs/V0.5.0_COMPARISON_AND_VALIDATION.md:55, docs/JEJU_V052_VALIDATION.md, docs/DICTATION_V053_VALIDATION.md:38, docs/UI_ACCEPTANCE_REPORT.md:44, outputs/youtube-conversation/native-qa.json, HANDOFF/benchmark/engine-comparison.json 및 validation/failure-and-recovery.json.

## 이미 확인되어 미완료로 다시 세지 않는 항목

- 한국어 Whisper small-q5_1 설치파일 동봉, 오프라인 적재, 실제 CUDA 추론, 아이콘 정본 보존, v0.5.5 빌드·설치 교체.
- v0.5.1 실제 YouTube LjwQhxDYsP8의 0~600초 녹음: 재생 600.49초, 88구간, unmanaged-state 오류 없음. 근거는 후보 루트 `C:/Users/Public/Documents/ESTsoft/CreatorTemp/streamrecord-v0.5.0-candidate/outputs/korean-bundled-0.5.1/youtube-10min-result.json`. 이때 실시간 요약은 꺼져 있어 요약 평가 증거는 아니다.
- v0.5.3 실제 Stereo Mix→Whisper→로컬 Ollama 문장 보정→저장→정상 재시작. 녹음 3구간의 원문은 이미 자연스러워 보정 결과가 동일했고, 별도 합성 오타 2문장은 실제 모델 수정이 확인됐다.
- 수동 용어 힌트/이전 문맥, 원음 구간 재생, 직접 검토본, 저장 음성 24초 체크포인트 재개, 원문/AI 보정본 분리 및 TXT 내보내기.
- v0.5.5 설치본 YouTube 전체 대화에서 원문/보정본/원문 함께 보기 확인 및 기존 원문94개·보정94개 보존.
- YouTube iframe의 메뉴 이동 시 유지와 넓은 전사 읽기 영역.

## 배포·부가 항목

- 현재 소스와 설치본은 v0.5.5. 마지막 완료된 GitLab/Drive 게시 영수증은 v0.5.3(2026-09-30 KST). v0.5.4/0.5.5는 미게시 기록. GitLab 원격 현재 상태는 이 감사에서 새로 인증 조회하지 않았으므로 '마지막 확인된 게시 기록'으로 한정한다.
- 지정 Drive 폴더의 2026-10-01 목록에서도 v0.5.0/v0.5.3 배포 폴더를 확인했다. 신규 업로드는 하지 않았다.
- 설치파일은 미서명이다. 무결성 해시 검증은 완료돼 있으나 게시자 코드 서명과 별개이며, 사용자 필수 기능 누락으로 단정하지 않는다.
- 전체 전사 화면 768px 안내문 줄바꿈 관찰이 남아 있다. 주요 YouTube 전체 대화 기능 차단 사항은 아니다.
- Qwen3 ForcedAligner는 기본 시간정보 부족이 실측됐을 때 검토하는 조건부 항목. HLS/HWPX는 과거 문서의 후속 확장 후보로 이번 확정 미완료 요구와 별도다.
- 회의록이 AI 보정본을 자동 사용하지 않고 사람 검토본 또는 원문을 쓰는 것은 명시된 보존 계약이다. 요구사항 누락으로 세지 않았다.
- YouTube는 실제 Stereo Mix 기반으로 다른 PC 소리도 함께 들어갈 수 있고 해당 장치가 없는 PC에서는 사용할 수 없다. 영상 오디오만 분리하는 수집/재생 동기화는 현재 범위에 없다. 기존 요구가 내부 프레임+실시간 전사였으므로 이를 별도 신규 필수 기능으로 만들지 않는다.

## 처리 우선순위 제안

1. 내려받은 요약 모델 연결(F4), 공급자 설정과 실제 어댑터/안내 통일(F6), 실제 전송 위치·키 저장·URL 제한(D1~D3).
2. 사용자가 지정한 Nemotron 화자분리(F1), 공식 제주 용어 사전팩(F2), 같은 corpus의 후보 비교(F3).
3. 전체 누적 실시간 요약(F7), 비정상 종료 작업 복구(F8), 장시간·품질·장애 검증.
4. 검증한 빌드의 GitLab·Drive 게시 및 버전별 미완료 목록 동기화.

## 검토 기록

요구사항, 코드 연결, QA 증거, 데이터 보호, 인계·배포의 5개 독립 읽기 검토가 모두 AUDIT_COMPLETE로 종료했다. 이것은 제품 승인 PASS가 아니다. 결과가 같은 미완료를 가리킨다고 테스트를 실제 실행한 것으로 바꾸지 않았다. 보고서·근거 기록만 추가했으며 제품 소스는 변경하지 않았다.
