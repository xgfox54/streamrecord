# Stream-Record 0.4.0 UI 수용 검사 보고서

작성일: 2026-09-21 (KST). `PASS (범위)`는 적힌 범위에서만 통과했다는 뜻이며, `NOT_RUN`은 실제 성공 근거가 없다는 뜻이다. GitLab 게시 완료 여부는 게시 후 생성되는 `outputs/korean-bundled-0.4.0/deployment-result.json`을 기준으로 판정한다.

## 1. 최종 산출물

| 항목 | 결과 |
|---|---|
| 설치파일 | `Stream-Record-0.4.0-korean-bundled-windows-x64-setup.exe`, 223,598,533바이트, CRC32 `4d168fc0`, SHA-256 `518fefffcc12a7fe9ec4e9da1d4e31808592c4797a723c09340db43dd49c4061` |
| 빌드된 EXE | SHA-256 `c6b674a41659b3adf5c9fde00e8525b1277aba289650e9293008c34148472d52` |
| 설치된 EXE | SHA-256 `98bbd6625900b02b5f8c379ad9fdee49200eb37f540d18ef1e5f63471075ba2e` |
| 동봉 한국어 모델 | `small-q5_1`, 190,085,487바이트, SHA-256 `ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb` |
| 아이콘 정본 | SHA-256 `ad509a00e923e6a69fbbc7c26e1a08be77e72ae6fb45ab138f05a6193ba75f84`; 파생 32파일 검증 |
| 설치 백업 | `outputs/korean-bundled-0.4.0/installed-backup-1789998318674` |

## 2. 구현 결과

- 회의 녹음 화면에서 부분 문장이 실시간으로 이어지고 확정 문장으로 교체되는 전사 패널을 추가했다.
- 사용자가 명시적으로 켠 경우에만 확정 전사로 현재 요약을 갱신한다. 요약 모델이 없어도 녹음과 전사는 사용할 수 있다.
- 받아쓰기 전용 화면을 추가했다.
- YouTube 전사 화면에 앱 내부 `youtube-nocookie.com` 플레이어 영역과 실시간 전사·요약 패널을 배치했다. 별도 영상 창은 열지 않는다.
- 녹음, 전사 원문, 검토본, 기존 설정과 데이터 경로를 보존했다.
- 최초 설치에는 한국어 Whisper 모델을 포함하고 추가 다운로드 없이 준비한다.
- 최초 설치에는 요약 모델을 포함하지 않는다. 로컬 요약 모델은 사용자가 선택해 내려받을 수 있으며, OpenAI 호환 엔드포인트와 OpenCodex 프록시는 선택 사항이다. Aside와 OpenCodex가 없어도 로컬 녹음·전사는 동작한다.
- 활성 화면의 제품명은 `Stream-Record`로 정리했다. 데이터 보존을 위해 내부 앱 식별자 `local.meetily.korean.workspace`는 유지한다.
- 작업영역 CSS의 중복 규칙을 제거하고 글자, 간격, 반경, 컨트롤 크기와 주요 레이아웃 값을 공통 디자인 토큰으로 통합했다.
- GitLab 사전 수신 보안 훅이 탐지한 `RUSTSEC-2026-0293`을 해소하도록 `ringbuf`를 0.4.8에서 수정 버전 0.5.2로 갱신했다.

## 3. 자동 검증

| 검사 | 결과 | 범위 |
|---|---|---|
| 패키지 게이트 | PASS | 118 통과, 0 실패 |
| UI 세션 | PASS | 21개; 실제 세션 훅, 부분→확정 전사, YouTube 내부 프레임, 실시간 요약, 화면 이동 중 녹음 보존 |
| 프런트 회귀 | PASS | 42개 |
| 릴리스 도구 | PASS | 27개 |
| Rust | PASS | 25개와 `cargo check` |
| 타입 검사 | PASS | `tsc --noEmit` |
| production build | PASS | Next.js static production output 생성 |
| 한국어 모델 | PASS | 실제 모델 오프라인 적재 및 NSIS 포함 무결성 |
| 설치파일 | PASS | NSIS 구조·CRC32·SHA-256 검증 |
| 설치본 | PASS | EXE·모델·manifest·라이선스·런타임 동반 파일 해시 일치 |

## 4. 화면 및 설치본 검증

- production `out`을 데스크톱과 390×844 모바일 뷰포트에서 열어 내비게이션, YouTube 전사, 내부 플레이어 영역, 실시간 전사와 실시간 요약 레이아웃을 육안 확인했다.
- 증거 파일:
  - `app/frontend/test-results/v0.4.0-ui-desktop.png`
  - `app/frontend/test-results/v0.4.0-ui-mobile.png`
- 브라우저 증거의 `transformCallback` 오류는 Tauri IPC가 없는 정적 브라우저에서만 발생하는 예상 경계 오류다.
- 최종 설치된 v0.4.0 실행파일의 버전과 해시를 확인한 뒤 프로세스를 실행했고 응답 상태를 확인했다. 동일 패키지의 production 프런트엔드 픽셀은 위 데스크톱·모바일 증거로 확인했다.
- 이 관리형 자동화 세션의 GDI/PrintWindow는 WebView2 하드웨어 합성 픽셀을 검은 화면으로 반환했다. 따라서 설치본의 픽셀 캡처는 검증 근거로 사용하지 않았다.

## 5. 미실행 및 알려진 한계

| 항목 | 판정 | 이유 |
|---|---|---|
| 실제 마이크 녹음 | NOT_RUN | 주변 마이크는 사용자 요청에 따라 녹음하지 않았다 |
| 실제 Stereo Mix 녹음 | NOT_RUN | 관리형 세션에서 ffmpeg DirectShow 오디오 장치가 열거되지 않았다 |
| 실제 구독/API 모델 요약 추론 | NOT_RUN | 외부 계정·비밀키를 사용하지 않았다 |
| 3시간 장시간 녹음 | NOT_RUN | 자동 복구·재개 회귀만 수행 |
| Windows 화면 낭독기·실제 DPI 배율·고대비 실측 | NOT_RUN | 브라우저 반응형 및 강제색 코드 검사만 수행 |
| 설치파일 코드 서명 | 미서명 | 게시 자산에 서명 정책을 `unsigned`로 기록 |
| 호환 엔드포인트 비밀키 보관 | 제한 | 입력은 마스킹되지만 현재 로컬 Tauri store에 저장된다. 배포 소스와 로그에는 포함하지 않는다 |
| 원격 HTTP 엔드포인트 | 제한 | 사용자가 지정한 비 TLS 주소도 허용한다. 신뢰 가능한 로컬 프록시 또는 HTTPS 사용이 필요하다 |

실제 장치·외부 모델·접근성 실측 항목은 위 표의 범위를 넘어서 완료로 보고하지 않는다.
