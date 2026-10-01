# Connection backend implementation evidence (2026-10-01)

## Implemented

Seven explicit connection kinds: OpenCodex, OpenClaw, OpenRouter, OpenCode, generic OpenAI-compatible, OpenAI API, Anthropic API. OpenRouter is a hosted routing service; it is not described as an open-source proxy. Profile UUID identifies routing independently of model name. Each profile has an independent label, destination, enabled state, manual model IDs, authentication and revision.

Frontend DTOs return hasApiKey only. API secrets use Windows DPAPI user scope through windows-dpapi 0.2.0 safe API. Ciphertext is synced into a temporary file and atomically replaces the previous encrypted file; no plaintext temporary file is used. Stable encrypted keys live under the current user's LocalAppData/Stream-Record/credentials. A changed destination, protocol or Basic username cannot silently reuse a saved secret. Unsupported operating systems fail closed instead of storing plaintext. OAuth registry uses the same arbitrary-length encrypted storage API.

Legacy proxy configuration migrates into the explicitly labelled OpenCodex connection. A plaintext legacy entry is cleared only after protected key and metadata persist. Migration failures retain the old record and report a fixed, secret-free warning. Old setter no longer writes plaintext.

HTTP is limited to parsed loopback IPs or localhost (localhost resolver is pinned to 127.0.0.1); other destinations require HTTPS. URL userinfo/query/fragment are rejected. Requests use connection and total timeouts, never follow redirects, bypass ambient HTTP proxies and cap response bodies at 4 MiB. Error responses expose status category only, not server body or secrets.

## Distinct protocols

- OpenCodex / OpenRouter / OpenAI-compatible: GET models, POST chat/completions.
- OpenAI API: chat completions with max_completion_tokens.
- Anthropic API: native messages endpoint, x-api-key and anthropic-version header, typed content blocks.
- OpenClaw: agent-target catalog, not a raw backend model inventory. Generation requires the operator's explicit confirmation that a separate text-only agent has all tools denied. Client tools=[] and tool_choice=none do not alone establish server-side isolation; this prerequisite is displayed in the UI. No agent configuration is silently modified.
- OpenCode: native provider catalog filtered to connected providers; an isolated session receives wildcard deny permissions. The returned permission policy must confirm that denial before any text is sent. A text-only message is posted to that session and only that session is deleted afterwards, including request failures. Older servers that omit the policy fail closed.

Catalog checks do not count as inference checks. The dedicated, explicitly invoked ko_probe_connection sends only a harmless greeting and returns destination and response length, not transcript data.

## Verification

The independent Cargo harness under outputs/connections-harness includes the exact production credentials, endpoint, transport and adapter source files. Fourteen tests passed against actual local TCP HTTP servers and real Windows DPAPI. Tests cover loopback boundaries, destination/model binding, native Anthropic and OpenCode protocols, output truncation, redacted HTTP failures, unconfirmed OpenClaw refusal, missing OpenCode deny policy refusal, redirect rejection without forwarding a disposable bearer secret, and large encrypted credential replacement.

The harness does not include Tauri metadata store commands. Full-app compilation, profile persistence integration, frontend/native operation and packaging remain the integrator's separate checks. No existing real credentials were inspected; no external provider inference was performed by this backend task.

## Primary references checked

- https://docs.openclaw.ai/gateway/openai-http-api (agent-target model contract and full-operator security boundary)
- https://opencode.ai/docs/server/ (native API, Basic auth)
- https://github.com/anomalyco/opencode/blob/dev/packages/sdk/js/src/v2/gen/types.gen.ts (SessionCreateData.permission, SessionPromptData.tools and model shape)
- https://docs.rs/windows-dpapi/0.2.0/windows_dpapi/ (safe user-scope protect/unprotect)
- https://learn.microsoft.com/windows/win32/api/dpapi/nf-dpapi-cryptprotectdata (Windows user-scope protection)

## Concurrent profile changes

Encrypted connection records contain both revision and secret, including an explicit empty secret for anonymous connections. Authorization reads this single atomic record and checks the captured profile revision before sending a request. Missing/mismatched records fail closed. Upsert restores the exact previous encrypted record if metadata persistence fails. `resolve_revision(app, id, expected_revision)` additionally rejects stale queued model selections before generation. It accepts `None` only for legacy callers; the current frontend should pass its selected model revision.

OpenCode snapshots that verified authorization once for its multi-request native session. Cleanup therefore uses the original credential and original destination even if settings are changed while a response is pending. It never reads a replacement secret into the old session.

The race regression first failed with a real TCP connection reaching the old destination (`outputs/connections-harness/race-before.log`), then passed after the binding fix. Other tests verify missing credentials cannot become anonymous requests and native session cleanup retains the original authorization. Latest total: 14 passed; Clippy with warnings denied passed. The encrypted revision format is introduced before release; no unsafe reinterpretation of an ambiguous, partially-written credential record is performed.

## Implicit OpenCodex upgrade regression found during native QA

The installed v0.6.0 candidate showed no OpenCodex connection although previous versions had used it. Actual legacy metadata inspection found an existing two-byte `{}` store in Roaming/local.meetily.korean.workspace, with no endpoint property. Startup migration was wired correctly; it only handled an explicitly persisted endpoint, whereas v0.5.5 also used the implicit loopback10100 default.

The migration now checks the real legacy file before opening a Tauri store: absent file is a new installation and remains absent; existing empty store becomes the previous OpenCodex default once; a completed connectionId marker prevents recreation after the user deletes that profile. Explicit endpoint/credential migration still uses the existing DPAPI and rollback logic. Four file-based regressions cover these distinctions. The observed `{}` case failed first, then the full suite passed18/18; Clippy with denied warnings passed. No actual user configuration was modified by these tests. Final rebuilt-installation/native verification belongs to the parent QA run.
