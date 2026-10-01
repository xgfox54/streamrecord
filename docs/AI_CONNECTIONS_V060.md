# v0.6.0 AI 연결 사용

## ChatGPT 공식 OAuth

1. Stream-Record의 **AI 연결**에서 **ChatGPT 계정 → Continue with ChatGPT**를 누른다.
2. 열린 공식 브라우저에서 사용자가 직접 로그인하고 권한을 확인한다. 앱이나 대화창에 비밀번호·일회용 코드·토큰을 붙여 넣지 않는다.
3. 앱으로 돌아와 연결 상태와 모델 목록을 확인한다. 모델 목록 조회 성공과 실제 요약 성공은 별도이다.
4. 회의록·자동 보정·실시간 요약에서 사용할 ChatGPT 모델과 실제 전송 주소를 확인한다.

OpenCodex 또는 Codex Desktop 설치는 필요하지 않다. [OpenAI 공식 오픈소스 앱 직접 로그인 흐름](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)을 사용한다. 사용 가능한 모델과 구독 사용 여부는 공식 서비스가 반환하는 권한에 따른다. 로그인을 취소하거나 계정을 해제하면 해당 연결로 새 요청을 보내지 않는다.

공식 직접 연결은 현재 [SIWC 미리보기 제한](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)을 따른다. 일반 API와 지원 옵션이 같다고 가정하지 않으며 응답 완료 이벤트를 받아야 성공으로 처리한다.

## 서버 또는 API 연결

연결 종류를 **OpenCodex**, **OpenClaw**, **OpenRouter**, **OpenCode**, **기타 OpenAI 호환**, **OpenAI API**, **Anthropic API** 중에서 고르고 주소·필요한 인증정보를 저장한다. 여러 프로필을 따로 보관할 수 있다. OpenRouter는 호스팅 서비스이며 설치형 오픈소스 프록시로 안내하지 않는다.

**모델 조회** 후 **실제 응답 시험**을 각각 확인한다. 조회만 성공했다고 생성이 가능한 것은 아니다. OpenClaw의 에이전트 대상과 도구 사용 조건, OpenCode의 세션/권한 조건은 화면 안내를 따른다. 호환 API 여부를 알 수 없는 서버는 자동으로 지원 완료라고 표시하지 않는다.

저장한 서버는 다른 외부 서비스로 다시 전송할 수 있다. 실제 전송 위치를 확인한 뒤 해당 모델을 선택한다. 계정·주소·모델 설정을 바꾼 후에는 새 목록에서 다시 선택한다. 인증정보는 Windows 사용자 DPAPI로 보호된다.

## 로컬 모델

Ollama 또는 사용자가 선택 다운로드한 내장 GGUF 모델을 사용한다. 최초 설치에서는 요약 모델을 자동 다운로드하지 않는다. 한국어 음성 인식용 Whisper와 화자분리 모델은 설치파일에 포함되며 요약 모델과 별개이다.

실제 사용자 계정 인증·외부 공급자 성공 여부는 docs/V060_VALIDATION.md의 실행 결과와 구분해 확인한다.
