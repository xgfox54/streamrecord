# v0.6.0 게시 전 보안 수정

2026-10-01 실제 GitLab push는 테스트용 JWT 5개와 jsonwebtoken 9.3.1의 GHSA-h395-gr6q-cpjc로 거절됐다. 그 시점 원격 main·태그·릴리스는 변경되지 않았다.

- jsonwebtoken을 수정 버전 10.3.0으로 고정했다. 테스트 토큰과 개인키를 소스에 저장하지 않고 시험 실행 시 메모리에서 RSA 키와 토큰을 생성한다. 서명·발급자·대상·nonce·만료 검증을 유지한다.
- 잘못된 nbf 자료형 회귀 시험은 9.3.1에서 실패했고 10.3.0에서 통과했다. 독립 프로토콜/신원 시험 23개와 실제 저장된 ChatGPT 세션 응답 시험 1개를 통과했다.
- 추가 사전 검사에서 발견한 Next.js 16.3.5 및 brace-expansion 2.1.4를 각각 16.3.6, 2.1.7로 교체했다.
- 공식 Gitleaks 8.30.1로 배포 소스 검사: 5개 검출 → 0개. OSV-Scanner 2.6.0으로 Rust/npm lockfile 검사: exit 0. 기존 플랫폼별·미관리 알림 정책은 변경하지 않았으며 새 예외나 검사 우회는 추가하지 않았다.
- 이 결과는 새 설치파일·설치·원격 게시 성공을 대신하지 않는다. 최종 빌드/설치와 게시 결과는 V060_VALIDATION.md 및 각 배포 영수증으로 확인한다.

공식 근거: [jsonwebtoken 보안 권고](https://github.com/Keats/jsonwebtoken/security/advisories/GHSA-h395-gr6q-cpjc), [Next.js 보안 권고](https://github.com/vercel/next.js/security/advisories/GHSA-vcvr-r3jv-pc5j), [brace-expansion 보안 권고](https://github.com/juliangruber/brace-expansion/security/advisories/GHSA-q2hr-2g5m-vwhr).
