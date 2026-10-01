# 2026-10-01 미완료 개선사항 구현 계획

기준: UNFINISHED_IMPROVEMENTS_AUDIT_20261001.md 및 사용자 요청. 기존 작업 트리와 사용자 데이터 유지. 작업 시작 소스 백업 outputs/improvements-20261001/pre-change-source.tar.gz.

1. [completed] 현재 소스·실행 작업·공식 SIWC OAuth 및 연결 프로토콜 확인, 백업.
2. [completed] 모듈 구현 및 통합: 직접 ChatGPT OAuth, 분리 연결 프로필/보호 저장, 다운로드 로컬 GGUF 연결, 누적 요약, Nemotron 화자분리, 전사 큐 복구, 제주 후보 용어집 및 품질 비교 도구.
3. [completed] 회귀/타입/native 단위 검사, 실제 엔진 실행, 최종 브라우저 화면 검증 및 설치파일 무결성 확인.
4. [completed] 보안 수정 후 설치 교체 및 실제 UI·녹음·화자분리·ChatGPT 생성·재시작·사용자94구간 복원 검증.
5. [in_progress] GitLab·Drive 재게시와 원격 파일 다운로드 해시 검증. 결과는 outputs의 단계별 영수증으로 기록.

## 구현 범위와 한계
화자분리는 전체 녹음의 화자 캐시를 유지하는 네이티브 Nemotron 실행을 우선한다. 실시간 화자 스트림은 실제 지원 증거 없이 구현 완료로 표시하지 않는다. 기존 기본 한국어 Whisper 모델과 아이콘 정본 유지. 최초 설치에는 요약 모델을 자동 다운로드하지 않는다.

## 분담
OAuth, 연결 백엔드, 연결 UI, 화자분리 런타임, 복구, 용어/품질 도구 모듈은 통합 및 회귀 검사를 완료했다. 최종 설치본 검증과 게시 증거를 통합 담당이 확인한다.

## 통합 확인 (2026-10-01)
- v0.6.0 source version. Windows CUDA native check passed; prior unrelated warnings retained.
- Frontend regression51 + React session32 + release policy27 passed.
- Native stream_record_44 passed/5ignored; real built-in Qwen3.5 CPU adapter1 passed; independent3sample Korean WhisperCUDA baseline1 passed. Broader newly added native modules are separate filters in packaging.
- Browser115captures,17scenarios, axe0, JSerrors0, native boundaries explicitly fixtures. Independent visual reviewers both passed the same source/output-bound evidence.
- Native Nemotron real public97.6s audio25intervals/7channels,14.889s CPU; actualprocesscancelverified. This does not measure Korean speaker accuracy.
- Installer/signature/deployment/authentication are not implied by code/test success.

## 재현 가능한 화자분리 패키지 준비
소스 배포에 대형 모델·DLL은 포함하지 않는다. Windows에서 `tools/diarization/build-native.ps1`을 실행해 고정 NVIDIA 소스/모델을 준비한 뒤 결과 runtime 디렉터리를 `app/frontend/src-tauri/bundled-diarization`에 복사한다. `tools/package-korean-bundled.mjs --build`는 이 디렉터리를 통째로 EXE에 동봉한다. 설치·배포 단계가 모든 파일 SHA256을 패키지 입력과 비교한다. 기본 한국어 Whisper 모델도 계속 설치파일에 동봉된다. 로컬 요약 모델은 최초 설치 시 없음 상태를 유지한다.

## 실제 UI에서 발견한 추가 수정
- 기존 빈 proxy store의 암묵적 OpenCodex 기본 주소 이관 누락: RED→18회귀 PASS. 신규 설치 무생성/사용자 삭제 후 무재생성 보장.
- 공식 SIWC 요청의 비지원 max_output_tokens: 실제 서비스에서 동일 요청 필드 유무만 변경해 HTTP400→200 response.completed 확인. 요청 수정 후 오프라인15 및 실서비스1 통과. 보안 수정 전 후보에서 실제 GUI 회의록·누적 요약·AI 보정까지 통과했다. 아래 보안 재빌드의 설치본 확인은 별도로 수행한다.

## 게시 보류: 보안 재검증 (2026-10-01)
기능 검증 후 실제 GitLab push가 보안 검사에서 거절되었다. 테스트 JWT 정적 파일과 jsonwebtoken 9.3.1 취약점(GHSA-h395-gr6q-cpjc)이 원인이다. GitLab 원격 소스/태그/릴리스는 변경되지 않았으며 Drive 후보 폴더는 게시 보류로 표시했다. 보안 수정 후 다시 빌드·설치·검증하기 전에는 아래 이전 후보 해시를 최종 배포본으로 취급하지 않는다.

## 보안 재빌드 검사 완료
- jsonwebtoken10.3.0/Next16.3.6/brace-expansion2.1.7. Gitleaks0건, OSV exit0(기존 정책 유지).
- 보안 패치 후 자동 검사203/0, 네이티브 OAuth22 및 독립 프로토콜23, 저장된 공식 ChatGPT 세션 실제 응답1 통과.
- 새 화면115캡처/17시나리오, 두 독립 검토PASS. manifest5e3231919640a706c262a20b322f21c70f63a36416fbe65d05a83f95f767a6ed.
- 새 설치파일 SHA256 8cdd14c2654d31a82db5834c686d4d1c4e5231f127cd71b373ce0fffe6d632a9. 설치 교체/실사용 PASS. 재게시 결과는 별도 영수증으로 확인.
