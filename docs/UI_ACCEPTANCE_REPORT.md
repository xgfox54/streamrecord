# Stream-Record 0.2.0 UI 수용 검사 보고서

작성일: 2026-09-17 (KST). 소스 루트 `C:/Users/Rumans/Documents/Codex/Stream-Record`, 작업 증거 폴더(`TASK`) `C:/Users/Rumans/Documents/Codex/2026-09-17/stream-record-krds-uiux-md-assets/work`.

이 보고서는 구현, 자동 검사, 설치파일 생성, 설치본 교체, 실제 장치 시험, GitLab 게시를 각각 구분한다. `PASS (범위)`는 괄호의 범위에서만 통과했다는 뜻이고, `NOT_RUN`은 실제 시험을 수행한 성공 근거가 없다는 뜻이다. 게시 결과는 `outputs/korean-bundled-0.2.0/deployment-result.json`이 기준이며 이 문서만으로 게시 완료를 판정하지 않는다.

## 1. 최종 산출물 식별

| 항목 | 값 |
|---|---|
| 설치파일 | `Stream-Record-0.2.0-korean-bundled-windows-x64-setup.exe` 222,391,699바이트, CRC32 `1314038e`, SHA-256 `40b6f5679984387b2be7f4bad8a4716b4644575b1f41c85ef5291a23182f565a` |
| 빌드된 EXE | SHA-256 `14e4fcbcefe8c752da41fb2a752a17ab397c1b3aaa671d49244f35fc44596283` |
| 설치된 EXE | SHA-256 `5c144bceca3f28d66ab83075a2836c3b47baeb6bc43e9cbf40c776f948f488b3` (빌드 EXE와 Tauri 번들 유형 표식 3바이트 `__TAURI_BUNDLE_TYPE_VAR_UNK`→`_NSS`만 다름, offset 33,859,290) |
| 동봉 모델 | `ggml-small-q5_1.bin` 190,085,487바이트, SHA-256 `ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb` |
| 아이콘 정본 | `assets/branding/streamrecord-icon-source.png` SHA-256 `ad509a00e923e6a69fbbc7c26e1a08be77e72ae6fb45ab138f05a6193ba75f84`, 파생 32파일 manifest 검증 |
| 패키지 검사 | 114개 통과 (`package-result.json`): bundlePolicy, iconManifest 32, nsisIconConfiguration, nsisIconRecipe, uiContrast 16, uiSession 18, releaseTools 26, frontend 42, typecheck, rustCheck, rust 25, realModelOfflineLoad, installerIntegrity |
| 설치 결과 | `installation-result.json` complete=true, 백업 `installed-backup-1789630554249`, EXE·모델·manifest·라이선스·런타임 5개 해시 일치 |

폐기된 중간 후보 2건(SHA-256 `92aa5bfa…`, `6effecd8…`)은 설치·게시하지 않았다. 첫 번째는 녹음 방식 표시 초기화 결함, 두 번째는 설치 검증 도구가 Tauri 번들 표식을 고려하지 못한 문제로 대체했다. 근거는 `TASK/superseded-display-state-candidate/`와 `TASK/package-icons-final.log`다.

## 2. 이번 작업에서 수정한 결함

- 녹음 방식(마이크/PC 소리/영상)이 화면 로컬 상태여서 다른 화면을 다녀오면 실제 입력은 Stereo Mix인데 표시만 마이크로 돌아갔다. `useMeetingSession`의 공유 상태로 옮겼고, 실제 `RecordingView`를 구동하는 회귀 검사 2개가 수정 전 실패에서 수정 후 통과로 바뀌었다(UI 검사 18/18). 설치본에서도 녹음 중 5화면 이동 후 'PC 소리'·Stereo Mix 표시가 유지됐다(`installed-ui/navigation-result.json`).
- Tailwind 기본 글꼴이 존재하지 않는 외부 글꼴 변수를 참조해 본문이 Times New Roman으로 계산됐다. 시스템 글꼴 체인(system-ui, Malgun Gothic)으로 교체했고 실제 렌더링은 설치된 맑은 고딕만 사용한다(`TASK/font-computed-final.json`).
- NSIS 설치·제거 프로그램이 기본 NSIS 아이콘을 사용했다. `tauri.conf.json`의 `bundle.windows.nsis.installerIcon/uninstallerIcon`을 정본 ICO로 지정하고, 설정과 생성된 NSIS 레시피를 검사하는 패키지 게이트를 추가했다. 설치파일·설치된 EXE·uninstall.exe의 PE 아이콘 그룹이 정본 ICO와 일치한다(`TASK/pe-icons-final.json`, `TASK/pe-icons-installed.json`).
- 설치 검증 도구가 설치된 EXE를 빌드 EXE 해시와 직접 비교해 정상 설치를 실패로 판정했다. Tauri 번들러가 NSIS 생성 전 실행파일에 번들 유형 표식을 기록하고 생성 후 원본을 되돌리기 때문이다. 표식 치환 후 해시를 패키지 영수증(`installedExeSha256`)에 기록하고 설치·게시 도구가 그 값을 비교하도록 바꿨다(릴리스 도구 검사 26개 중 신규 1개).
- 빌드 시 JS/Rust Tauri 플러그인 minor 버전 불일치(updater, fs)를 npm 고정으로 해결했다.

## 3. 지시서 §12 수용 항목 판정

| ID | 검사 | 판정 | 근거 |
|---|---|---|---|
| ICON-01 | 정본 일치 | PASS | 정본 SHA-256 일치, manifest 32파일 검증, 내부 배경·도형 변경 없이 리샘플링 (`docs/ICON_GENERATION.md`) |
| ICON-02 | 투명도·소형 표시 | PASS (자산) | 16/32/48/128px 밝은·어두운 배경 검수, 192px 초과 확대 사실 기록 |
| ICON-03 | 설치 후 아이콘 | PASS (EXE·설치파일·제거 프로그램·바로가기·헤더) | 설치된 EXE와 uninstall.exe PE 아이콘 = 정본 ICO; 시작 메뉴·바탕화면 바로가기가 설치 EXE를 가리키고 아이콘 인덱스 0 사용; 설치 앱 헤더·설정 화면에 실제 이미지 표시(`installed-ui/recording-1366-0.png`, `settings-*`). 트레이 아이콘의 화면 사진은 별도로 찍지 않았다 |
| UI-01 | 포인트 색상 | PASS | `#0173bc`, `#f18101`, `#00a074` 토큰 사용, 설치본 동일 입력 |
| UI-02 | 텍스트 대비 | PASS (토큰·자동검사) | 불투명 조합 16개 대비 검사, 5화면 axe 위반 0, 89캡처 이중 시각 검토. Windows 강제색·모든 상호작용 상태의 실측은 NOT_RUN |
| UI-03 | 핵심 행동 | PASS (설치 앱) | 화면별 주 버튼 위계 캡처, 실제 녹음 시작·중지·저장·종료 수행 |
| UI-04 | 화면 배율 | PASS (브라우저 6폭·글자 125/150/200%) | 375~1920폭 89캡처 잘림 없음; 설치 앱 1366/1024 뷰포트 캡처. 실제 Windows DPI 125/150/200%는 NOT_RUN |
| UI-05 | 키보드 | PASS (설치 앱 주요 과업) | Space/Enter로 녹음 방식 선택·동의·녹음 시작·검토본 수정/저장·내보내기·오류 닫기·종료 대화상자 확인 수행 |
| UI-06 | 초점·스크린리더 | PARTIAL | 화면 전환 H1 초점, 모달 초점 가두기/복귀, axe 위반 0. 실제 화면 낭독기 NOT_RUN |
| UI-07 | 빈 상태·오류 | PASS (설치 앱 1사례 + 자동검사) | 잘못된 영상 주소 → 녹음 미시작, 기존 전사·원음 보존, 키보드로 안내 닫기(`installed-ui/error-check.json`). 모델 손상 등 다른 실패는 자동검사 범위 |
| REC-01 | 신규 사용자 첫 녹음 | PASS (기존 사용자 PC) | 설치 후 첫 녹음에서 동봉 small-q5_1이 사용자 모델 폴더로 복사·적재됨. 완전히 빈 PC의 첫 실행은 NOT_RUN |
| REC-02 | 네트워크 차단 | PASS (모델 적재 오프라인 검사) | `network=false` 실제 모델 적재 검사 통과. 설치 앱의 네트워크 차단 실행은 NOT_RUN |
| REC-03 | 모델 손상 | PASS (자동검사) | 손상/누락 모델 보존·미적재·자동 다운로드 없음 검사. 실제 설치 환경 손상 시험 NOT_RUN |
| REC-04 | 마이크·Stereo Mix | PASS (Stereo Mix) | 실제 `Stereo Mix(Realtek(R) Audio)`로 승인된 합성 한국어 시험 음성을 2회 녹음, 5문장이 정확히 전사됨(`installed-ui/approved-test-snapshot.json`, Exports TXT). 주변 마이크 녹음은 지시대로 수행하지 않음(NOT_RUN) |
| REC-05 | 페이지 이동 | PASS (설치 앱) | 실제 녹음 중 5화면 이동, 녹음 유지, 방식·장치 표시 유지, 시험 음성 누락·중복 없음 |
| REC-06 | 종료·재시작 | PASS (설치 앱) | 녹음 중 설정→종료→'녹음을 중지하고 저장한 뒤 종료' 실행, 원음 mp4·transcripts.json·Exports 저장 후 프로세스 종료, 재실행 시 6구간과 원음 경로 복원, 이전 세션 혼입 없음 |
| TXT-01 | 전체 검색·페이징 | PASS (웹 650구간 + 설치 앱 검색) | 브라우저 650구간 검색/페이지, 설치 앱에서 검토문 검색 결과 1건 고정 |
| TXT-02 | 원문 보존 | PASS (설치 앱) | 검토본 저장 후 모든 `text` 불변, `reviewed_text`만 기록, TXT/JSON 내보내기 |
| TXT-03 | 근거 ID·원음 | PASS (설치 앱) | 원음 연결 시 SHA-256 기록, S000001 구간 듣기가 164.76초부터 실제 재생 |
| TXT-04 | 자동 스크롤 | PASS (웹) | 과거 구간 읽기 중 새 구간 3개 수신에도 위치 유지, 최신 복귀(`TASK/autoscroll-qa`) |
| SUM-01 | 구조화 요약 | PARTIAL | 근거 ID·인용 검증 자동검사 통과. 실제 모델 추론 품질은 NOT_RUN |
| SUM-02 | 재개·취소 | PARTIAL | 자동검사 통과, 실제 중단·재개 NOT_RUN |
| AI-01 | 연결 상태 | PASS (목록 조회) | 설치 앱에서 실제 Ollama 모델 2개, 호환 프록시 모델 20개 수신 표시. 인증·추론 성공은 별개 상태로 표시 |
| AI-02 | 비밀정보 | PASS (소스 검사) | 게시 소스 선택 파일 비밀정보 패턴 0건, 토큰 마스킹 입력 |
| EXIT-01 | 완전 종료 | PASS (설정 종료 버튼) | 저장 후 프로세스 종료 확인. 트레이 메뉴 종료는 NOT_RUN |
| PKG-01 | 새 빌드 | PASS | 위 1절 |
| PKG-02 | 설치 확인 | PASS | 설치 직후 사용자 데이터 13개 파일 변경 0·추가 0(`TASK/user-data-preservation/after-install.json`은 이후 앱 사용에 따른 세션·DB 갱신과 모델 복사·내보내기 추가만 기록) |
| REL-01 | 원격 배포 | `deployment-result.json` 참조 | 게시 도구가 main·태그·릴리스·자산·공개 다운로드 해시를 검증한다 |

## 4. 관찰 사항과 한계

- 녹음 중지 및 저장 후 종료는 남은 구간을 CPU로 전사한 뒤 완료되며, 이 PC에서 약 5분 녹음 기준 5~10분이 걸렸다. 그동안 화면은 '마지막 음성 저장 중…' 상태를 유지하고 데이터 손실은 없었다. 이는 상위 Meetily 파이프라인의 처리 방식이며 이번 작업에서 바꾸지 않았다.
- 원음 연결 후 저장되는 경로는 Windows 정규화 접두사(`\\?\`)가 붙는다. 재생과 복원에는 영향이 없었다.
- 브라우저 검사는 native 경계를 모의한다. 설치 앱 검증은 CDP 뷰포트 에뮬레이션이며 실제 Windows 배율 변경이 아니다.
- 마이크 녹음, 장시간(3시간) 녹음, 화면 낭독기, 새 PC 첫 설치, 트레이 메뉴 종료, 실제 요약 추론은 수행하지 않았다.
- `BUILD_VERIFICATION.json`의 `physicalAudioTest` 필드는 패키징 파이프라인이 자체 수행한 장치 시험이 없다는 뜻(`not_run`)이며, 실제 Stereo Mix 시험 증거는 이 문서와 `installedUi.evidenceFiles`에 기록된다.

