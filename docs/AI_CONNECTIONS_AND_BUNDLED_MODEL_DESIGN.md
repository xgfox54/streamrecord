# Stream-Record: 한국어 모델 내장 설치본과 개인 AI 연결 설계

검토일: 2026-09-17. 이 문서는 구현 완료 선언이 아니라, 현재 반영한 모델 패키징 변경과 이후 AI 연결 구현 명세를 구분한 설계다.

## 1. 범위와 현재 상태

한국어 음성 인식과 회의록 요약 모델을 분리한다. 기본 음성모델은 다국어 Whisper small-q5_1이며 설치 프로그램 안에 포함한다. 사용자는 음성모델을 별도로 설치하거나 계정을 등록하지 않고 녹음을 시작할 수 있어야 한다. 첫 시작의 로컬 파일 검증·등록 및 모델 적재 시간은 있으며, 준비 완료 전에는 녹음을 시작하지 않는다.

음성모델 내장이 GPT/Claude 또는 로컬 요약 LLM까지 내장한다는 뜻은 아니다. 회의록 생성에는 아래의 AI 연결 중 하나가 필요하다. Whisper 인식과 달리 온라인 요약에는 서비스 연결과 해당 계정의 사용 권한이 필요하다.

이번 변경의 구현 범위: bundled_whisper.rs, ko_prepare_bundled_whisper 명령, korean-model.ts의 동봉 우선/자동 다운로드 제거, Windows 리소스 매핑, 모델 준비·패키징 도구와 검사. 새 연결 관리 UI 및 공급자 어댑터는 아래 설계이며 아직 기존 화면에 구현됐다고 표시하지 않는다.

현재 노트북의 127.0.0.1:10100은 조사 당시 @bitkyc08/opencodex의 bun 프로세스가 사용했고 /v1/models는 HTTP 200을 반환했다. 이 사실은 구독 계정의 실제 인증 또는 추론 성공을 의미하지 않는다. 인증 파일과 토큰은 조회하지 않았다. 조사 근거: outputs/hf-redirect-fix-20260917/hotfix-result.json. 개발자의 이 로컬 설정을 배포 사용자의 기본 연결로 간주하면 안 된다.

## 2. 한국어 음성모델 포함 방식

### 2.1 배포 파일

설치 리소스에 다음 세 파일을 명시적으로 포함한다.

- bundled-models/ggml-small-q5_1.bin
- bundled-models/manifest.json
- bundled-models/WHISPER-LICENSE.txt

모델 파일은 현재 고정 버전 기준 190,085,487바이트다. 정확한 커밋·SHA-256의 기준은 src/whisper_engine/model_integrity.rs이며 빌드 도구가 이 값을 읽는다. README 모델표의 SHA1이나 Xet 청크 해시로 바꾸지 않는다. 모델 출처는 Hugging Face의 ggerganov/whisper.cpp이고 Meetily 제작자의 서버가 아니다. MIT 고지를 설치본에 포함한다.[S1][S2]

Windows 전용 tauri.windows.conf.json은 공통 bundle.resources를 덮어쓰므로 이 파일에도 모델 매핑을 추가한다. 빌드 시 모델 크기와 해시, 매핑, 라이선스 존재를 확인하고 하나라도 틀리면 실패한다. 모델이 빠진 설치파일을 정상 배포물로 만들지 않는다. 대용량 bin은 소스 Git에 커밋하지 않고 설치파일/패키지로 배포한다.

### 2.2 실행 흐름

기존에 선택한 설치 완료 다국어 모델이 있으면 유지한다. 없으면 앱의 Resource 경로에서 동봉 모델을 찾고 해시를 확인한다. 각 Windows 사용자의 기존 app_data_dir/models 안에 임시 파일을 독점 생성하고, 복사·fsync·해시 검증 후 기존 파일을 덮어쓰지 않는 방식으로 등록한다. 이후 기존 엔진의 목록 갱신·적재 및 ko 언어 설정을 수행한다.

기존 파일이 손상됐어도 자동 삭제/덮어쓰기하지 않는다. 동봉 파일이 없거나 잘못됐을 때 인터넷으로 조용히 전환하지 않는다. 오류에는 '모델 포함 설치본으로 복구'를 안내한다. 고급 사용자의 다른 모델 수동 다운로드 경로는 기본 녹음 경로와 구분한다.

모델 복사본을 사용자 데이터에 두므로 설치 리소스와 사용자 모델 파일이 각각 공간을 차지할 수 있다. 이 방식은 다중 사용자, 설치 폴더 쓰기 권한, 기존 모델 목록과의 호환성을 우선한 선택이다. 현재 안전 등록은 같은 디렉터리의 하드링크를 이용하므로 이를 지원하지 않는 파일시스템에서는 명확히 실패해야 하며 기존 파일을 덮어쓰는 대체 경로를 사용하지 않는다.

'모델 오프라인'과 '완전 오프라인 Windows 설치'는 다르다. Windows에 WebView2 같은 선행 런타임이 없으면 기존 설치 프로그램의 런타임 설치 정책을 별도로 확인해야 한다. 첫 녹음 무네트워크 시험은 필수 런타임이 설치된 Windows 환경과 빈 모델 폴더를 사용한다.

### 2.3 검증 항목

첫 녹음 경로에서 downloadModel 호출 0회, 빈 목록에서도 동봉 모델 선택, 기존 모델 선택 유지, 손상·복사 실패 시 녹음 미시작과 원문 보존, 동시 실행 시 목적 파일 비덮어쓰기, 설치 리소스와 실제 설치 폴더 모델 해시 일치를 검증한다. 오프라인 통합검사는 임시 모델 디렉터리로 실제 동봉 모델을 등록하고 현재 Whisper 엔진으로 적재한다. 이는 마이크 캡처나 한국어 정확도 검증을 대신하지 않는다.

## 3. AI 연결 유형

| 공급 경로 | 사용자가 하는 일 | 인증 보관 주체 | 비용/제약 |
|---|---|---|---|
| ChatGPT 구독 -> 공식 Codex 런타임 | 연결 관리에서 공식 로그인 시작, 외부 브라우저에서 본인 로그인 | 공식 Codex 런타임 | 해당 계정의 Codex 접근 권한·모델·한도 적용 |
| OpenAI API -> GPT | 본인 API 키 입력 | Windows 보안 저장소 | API 사용량 과금, ChatGPT 구독과 분리 |
| Claude 구독 -> 변경하지 않은 공식 Claude Code | 공식 바이너리 설치/선택, 공식 인증 흐름에서 본인 로그인 | 공식 Claude Code | 개인 계정의 허용 범위·사용량 정책 적용 |
| Anthropic API -> Claude | 본인 API 키 입력 | Windows 보안 저장소 | Claude API 사용량 과금 |
| Ollama | 서버 주소 확인, 설치된 모델 선택 | 로컬 실행은 일반적으로 별도 인증 없음 | PC 자원 사용. 원격/클라우드 모델이면 별도 표시 |
| 로컬 GGUF | 파일 선택과 런타임 호환성 검사 | 계정 없음 | 지원 아키텍처·템플릿·메모리 한도 내에서 사용 |
| OpenAI 호환 서버 | 본인 서버 주소/선택적 API 키 입력 | Windows 보안 저장소 | 서비스 종류·요금은 별도 확인, 구독으로 자동 분류 금지 |

서버 주소나 모델 ID가 있다는 이유로 로그인됨·구독 포함·무료·정상 추론이라고 표시하지 않는다. 모델은 조회 결과 또는 사용자가 지정한 모델 ID를 저장하며 '모든 모델 지원'을 보증하지 않는다.

## 4. 구독 인증 설계의 중요한 경계

### 4.1 ChatGPT

공식 Codex App Server는 account/login/start의 chatgpt 로그인, account/read, account/logout, model/list, 계정 사용 한도 조회를 제공한다.[S3][S4] Stream-Record는 자체 OAuth client ID나 브라우저 쿠키를 만들지 않고 공식 런타임의 관리형 인증을 사용한다. 로그인 버튼은 공식 반환 URL만 시스템 브라우저에 열고, 성공 알림과 계정 상태를 확인한다. experimental chatgptAuthTokens로 토큰을 직접 주입하는 경로는 사용하지 않는다.

요약 요청은 공식 런타임에 위임한다. 공개 API 호출로 가장하거나 비공개 ChatGPT HTTP 엔드포인트를 직접 호출하지 않는다. 공식 런타임이 실제 제공하는 모델/기능만 노출한다. 계정별 한도 소진 시 다른 계정·유료 API로 자동 우회하지 않는다.

### 4.2 Claude

2026-09-17 확인한 공식 문서는 '자체 앱에 Claude.ai OAuth를 구현하거나 사용자의 구독 자격증명을 중개'하는 방식과 '변경하지 않은 공식 Claude Code에서 각 사용자가 자신의 구독으로 로그인'하는 방식을 구별한다. 후자는 조건부로 허용되는 경로로 설명돼 있으며 원본 바이너리를 변조하거나 내장 인증 방법을 제거할 수 없다.[S5]

따라서 연결은 공식 Claude Code 실행 파일을 이용한다. 로그인은 claude auth login, 상태 확인은 claude auth status, 로그아웃은 공식 명령으로 수행한다.[S6] 비밀번호, 세션 쿠키, OAuth 토큰을 앱이 수집·복사하지 않는다. 직접 Anthropic API 어댑터에서는 API 키만 사용한다. 공식 문서의 Commercial Terms 및 배포 조건을 릴리스 전에 확인하고, 적용 범위가 명확하지 않은 호스팅/다중 사용자 환경에는 같은 개인 연결을 재사용하지 않는다.

공식 지원 문서의 2026-06-15 업데이트는 Agent SDK/claude -p/제3자 앱의 구독 사용량 변경 계획이 보류됐다고 설명한다. 그 아래의 월별 별도 크레딧 표는 시행 안내로 사용하지 않는다.[S7] 이 안내가 자체 OAuth 또는 자격증명 중개를 허용한다는 뜻으로 확대 해석하지 않는다. 이 설계는 직접 OAuth가 아닌 사용자 소유의 공식 Claude Code 실행 경로를 선택한다.

### 4.3 자동화 경계

두 공식 에이전트 런타임을 호출할 때 녹음 원문은 명령이 아닌 자료다. 셸 문자열 조합 없이 argv와 stdin을 사용한다. 요약 작업은 전용 임시 작업공간에서 실행하고, 도구·플러그인·MCP·훅·웹검색·파일변경을 기본 허용하지 않는다. 원본 공식 바이너리는 수정하지 않으며 문서화된 설정/옵션으로 제한한다. '--dangerously-skip-permissions' 같은 우회 옵션은 사용하지 않는다.

Claude의 -p/JSON 출력과 도구 제한 옵션은 버전별 지원을 검사한다.[S6] Codex도 설치된 공식 런타임에서 프로토콜 스키마/버전을 확인한 뒤 어댑터를 사용한다. 제한이 실제로 적용되지 않는 구버전은 연결은 보여주되 자동 요약은 비활성화하고 업데이트를 안내한다. 접근 제한은 지시문만으로 보장했다고 간주하지 않는다. 기존 CLI의 사용자 전역 설정과 타 프로젝트 권한을 바꾸지 않는다.

공식 CLI와 연결 상태를 공유하는 구성에서는 '연결 삭제'가 전역 로그아웃인지 앱 내 프로필 삭제인지 구분해 알린다. 공식적으로 격리된 자격증명 저장 경로를 지원하는 경우에만 프로필별 런타임을 분리한다. 임의로 토큰 파일을 복제해 다중 계정을 구현하지 않는다.

## 5. 사용자 화면

설정 > AI 연결에서 '연결 추가'를 누르고 구독 로그인, API 키, 로컬 실행, 호환 서버 중 하나를 고른다. 각 카드에 공급자, 사용자 별칭, 인증 상태, 실행 위치(이 PC/외부), 모델, 비용 방식, 마지막 확인 시각을 표시한다.

구독 로그인 카드는 공식 런타임 유무/버전, 로그인 시작, 로그인 취소, 계정 확인, 연결 해제를 제공한다. 앱 내부에는 비밀번호 입력란을 만들지 않는다. API 카드는 마스킹된 키 입력, 보안 저장/변경/삭제, 읽기 전용 모델 조회를 제공한다. Ollama 카드는 기본 loopback 주소, 모델 조회, 설치되지 않은 모델에 대한 명시적 다운로드 선택을 제공한다. GGUF 카드는 파일 선택, 해시/메타데이터, 지원 아키텍처, 메모리 설정을 제공한다.

연결 테스트를 두 단계로 구분한다. 첫 단계는 서버·계정·모델 접근 확인이며 추론을 하지 않는다. 두 번째는 '실제 응답 시험'으로 사용자가 명시적으로 실행하는 짧은 비민감 문장이다. 비용 발생 가능성을 표시하고 회의 원문을 시험 자료로 보내지 않는다. 모델 목록 응답을 추론 성공으로 보고하지 않는다.

## 6. 저장 구조와 공급자 인터페이스

연결 프로필의 개념 스키마:

```json
{
  "schemaVersion": 1,
  "id": "generated-uuid",
  "label": "내 OpenAI API",
  "kind": "openai_api",
  "authMode": "api_key",
  "endpoint": "https://api.openai.com/v1",
  "credentialRef": "os-vault-reference-only",
  "modelId": "returned-or-user-selected-model",
  "executionLocation": "remote",
  "billingMode": "api_metered",
  "enabled": true,
  "requiresExplicitRemoteConsent": true
}
```

이 JSON은 예시이며 실제 키/토큰/비밀번호를 넣지 않는다. 연결 프로필은 app_local_data_dir 아래에 저장하고, API 키는 Windows Credential Manager 또는 사용자 범위 DPAPI 등 검증된 보안 저장소에 보관한다. localStorage, 복구 JSON, 회의록, 진단 로그, Git에는 비밀값을 저장하지 않는다.

어댑터의 공통 동작은 validateConfig, connectionStatus, listModels, generateStructured, cancel, disconnect다. generateStructured는 기존 구조화 회의록 스키마를 유지하며, 지원하지 않는 네이티브 JSON schema 기능은 응답 JSON 검증과 제한된 재시도로 처리한다. provider/model/profile revision/prompt version/input hash를 체크포인트 키에 포함해 다른 공급자의 구간 요약을 조용히 재사용하지 않는다.

## 7. 엔드포인트와 데이터 보호

공식 API는 공식 HTTPS 호스트로 고정한다. 사용자 지정 호환 서버는 HTTPS가 기본이다. loopback의 로컬 서버만 HTTP를 기본 허용하며 사설망 HTTP는 별도 보안 옵션/사용자 확인이 필요하다. URL에 사용자명·비밀번호·토큰 쿼리를 넣지 않는다. 리다이렉트로 인증 헤더가 다른 호스트로 전달되지 않게 막는다. 외부 API 테스트 실패에 응답 본문이나 키를 통째로 로그에 남기지 않는다.

외부 요약 전 선택한 프로필과 전송 대상 호스트를 표시한다. 구독 프록시의 주소가 loopback이어도 뒤에서 외부로 전송할 수 있으므로 '로컬 AI'로 표시하지 않는다. Ollama도 remote_host/remote_model 또는 cloud 실행이면 외부로 구분한다. 로컬 전용 모드에서는 cloud CLI/API/프록시를 사용하지 않도록 네이티브 공급자 계층에서 검사한다.

GGUF는 확장자만 보고 정상 모델로 인정하지 않는다. 크기, 실제 형식, 아키텍처, tokenizer/chat template, 엔진 지원 여부를 검사한다.[S8] 엔진 실행 파일은 앱이 관리하는 것만 허용하고 임의 셸 명령 등록 기능을 만들지 않는다. 모델 파일 선택이 전체 폴더 접근 승인으로 확대되지 않게 한다.

## 8. 기존 설정 이관

기존 'subscription:modelId' 선택값을 자동 인증으로 이관하지 않는다. legacy-proxy 프로필 후보로만 표시하고 사용자 확인 후 활성화한다. 10100 포트를 모든 사용자의 기본값으로 고정하지 않는다. 기존 Ollama 선택값은 모델이 실제 존재할 때 이관하며 클라우드 속성을 재검사한다. 기존 전사문, reviewed_text, 회의록, 음성파일, 모델 파일 경로와 앱 식별자는 유지한다.

현재 ko_models/ko_generate의 local/subscription 분기는 ConnectionManager와 어댑터 레지스트리로 교체한다. 기존 구조화 요약 코드에는 어댑터 함수만 주입한다. 한국어 녹음 경로에는 연결 관리자의 로그인이나 모델 목록 조회가 선행 조건이 되어서는 안 된다.

## 9. 구현 순서와 완료 기준

1. 모델 동봉 설치본: 소스 연결 -> 빌드 시 실파일 준비/해시 -> 네이티브·프런트 검사 -> 모델 적재 통합검사 -> 패키지 생성 -> 설치 폴더 동봉 파일 해시 -> 첫 녹음 시험.
2. 연결 관리 기반: 프로필/보안 저장소/상태 구분, Ollama와 명시적 호환 서버, 직접 OpenAI/Anthropic API.
3. 개인 구독 어댑터: 공식 Codex 관리형 로그인과 변경하지 않은 Claude Code 로그인. 실제 사용자 계정으로 별도 승인된 로그인·짧은 응답·취소·만료·한도 시험을 수행한다.
4. 로컬 GGUF와 기능별 검증: 파일 호환성, 메모리 해제, 모델 교체, 구조화 출력, 재개 키/공급자 변경, 데이터 외부전송 금지.

실제 개인 계정 로그인과 유료 추론 시험은 이번 설계 작성만으로 완료됐다고 말하지 않는다. 현재 구현된 것, 검사만 된 것, 설계만 된 것, 실제 녹음으로 확인한 것을 릴리스 노트에 각각 기재한다.

## 근거 자료

[S1] https://huggingface.co/ggerganov/whisper.cpp/raw/main/README.md (MIT 모델 메타데이터와 모델 계열)
[S2] https://github.com/openai/whisper/blob/main/LICENSE (원본 MIT 고지)
[S3] https://developers.openai.com/codex/app-server/ (공식 관리형 로그인, 계정·모델·한도 인터페이스; 현재 ChatGPT Learn 문서로 이동)
[S4] https://developers.openai.com/codex/auth/ (ChatGPT 구독 인증과 API 키 인증의 분리)
[S5] https://code.claude.com/docs/en/legal-and-compliance (원본 Claude Code 실행·사용자 소유 인증 조건과 제3자 OAuth 제한)
[S6] https://code.claude.com/docs/en/cli-reference (auth login/status, -p, 출력 및 도구 제어 옵션)
[S7] https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan (2026-06-15 보류 공지)
[S8] https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md (GGUF 실행, 호환 서버)
[S9] https://docs.ollama.com/api/authentication (로컬/클라우드 인증 구분)
