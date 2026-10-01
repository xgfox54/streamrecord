# 제주도의회 용어 후보와 음성인식 품질 평가

## 이번 구현과 실제 수행

- 공식 [제454회 제7차 본회의](https://record.council.jeju.kr/CLRecords/Retrieval2/index.php?daesu=13&hfile=13A0110454071.html)의 EUC-KR HTML을 실제 수집하고 parse5로 본문을 파싱했다.
- 원문에 존재하는 용어 26개를 `assets/glossary/jeju-council-candidates.json`에 저장했다. 항목마다 출처 URL, 조회 시각, UTF-8 디코딩 HTML SHA-256, 최초 본문 위치, 출현 횟수가 있다. 이름·용어를 모델이 추정하여 추가하지 않았다.
- 모든 항목은 `candidate`(미검수), 기본 비활성이다. 사용자가 출처를 보고 선택하여 사용한다. 공식 출처에 존재한다는 뜻이며 의회가 검수·보증한 사전이라는 뜻은 아니다. 현장 발음·정확도 향상·재배포 권리 검토는 아직 완료되지 않았다. 원문 전체와 영상은 설치파일에 배포하지 않는다.
- `mergeHints`는 수동 입력 우선, NFC 정규화, 중복 제거, 500자 이내 전체 용어 단위 추가를 제공한다. 임의 문장 치환이나 원문 변경을 하지 않는다. 초과 용어는 별도 omitted 배열로 반환한다.
- 수집기 실제 실행 및 전용 9개 회귀 테스트 통과. 비교 CLI는 별도로 합성 입력임을 표시한 CLI 시험을 통과했다. 이는 실제 ASR 추론 정확도 시험이 아니다.

## 재현 명령

기존 프론트엔드 의존성 설치 후 저장소 루트에서 실행한다. parse5/Zod는 기존 프론트엔드 설치본을 사용하며 신규 런타임 의존성을 추가하지 않는다.

```
node tools/glossary/collect.mjs
node --test tools/glossary/*.test.mjs
node tools/glossary/prepare-quality.mjs
node tools/glossary/compare.mjs references.json runs.json report.json
```

실제 GPU 후보 추론은 Windows Git Bash에서 저장소 루트를 작업 디렉터리로 두고 아래 명령으로 실행했다. `uv.exe`는 [uv 공식 설치 배포본](https://docs.astral.sh/uv/getting-started/installation/) 0.12.21이다. 다른 PC에서는 공식 uv 설치 후 실행 파일 경로를 해당 위치 또는 `uv`로 바꾼다.

```bash
export UV_CACHE_DIR='C:/Users/Public/Documents/ESTsoft/CreatorTemp/srq056/uv-cache'
export HF_HOME='C:/Users/Public/Documents/ESTsoft/CreatorTemp/srq056-models'
export HF_HUB_CACHE='C:/Users/Public/Documents/ESTsoft/CreatorTemp/srq056-models/hub'
outputs/glossary-quality/runtime/uv.exe run --python 3.12 tools/quality/faster_whisper_compare.py
outputs/glossary-quality/runtime/uv.exe run --python 3.12 tools/quality/nemotron_compare.py
node tools/glossary/compare.mjs outputs/glossary-quality/references.json outputs/glossary-quality/faster-whisper-runs.json outputs/glossary-quality/faster-whisper-quality.json
node tools/glossary/compare.mjs outputs/glossary-quality/references.json outputs/glossary-quality/nemotron-runs.json outputs/glossary-quality/nemotron-quality.json
```

현재 PC의 `srq056`은 이 저장소 `outputs/glossary-quality`를 가리키는 Windows junction이다. 새 PC에서는 같은 이름의 짧은 전용 캐시 폴더를 사용해도 된다. HF 캐시는 junction이 아니라 실제 짧은 경로인 `srq056-models`를 사용한다. 긴 저장소 경로에 캐시를 두면 Torch DLL/Hugging Face snapshot 경로에서 WinError 206이 발생했던 것을 확인했다. 기존 사용자 모델 캐시와 섞지 않는다. 공개 모델 다운로드와 GPU 추론이 실행되며, `--prepare-only` 옵션은 모델 준비까지만 수행한다. Python 3.12와 엔진별 의존성은 uv가 격리하며 시스템 Python에 패키지를 설치하지 않는다.

`faster_whisper_compare.py`는 Torch 2.5.1 CUDA 12.1, `nemotron_compare.py`는 Torch 2.6 CUDA 11.8을 선언한다. Transformers의 Nemotron attention mask는 Torch 2.5에서 실행되지 않아 경로를 분리했다. 실제 통과한 모델 snapshot revision은 공유 `asr_runtime.py`에 고정했고, 검증 데이터 해시가 다르면 추론을 거부한다.

수집기는 고정된 공식 출처에 HTTPS 요청 1회만 수행하며, 크기·시간 제한을 둔다. 출처 문서 구조나 인코딩이 바뀌어 용어가 사라지면 빈 사전을 성공으로 만들지 않는다. `sourceSha256`은 전송 바이트가 아닌 디코딩한 HTML의 UTF-8 해시다.

## 평가 자료와 엔진 비교 계약

실제 [Google FLEURS 한국어 테스트셋](https://huggingface.co/datasets/google/fleurs)의 0~2행 음원과 공개 정답을 다운로드했다. CC-BY-4.0 출처, 데이터셋 revision, row ID, 음원 SHA-256을 `outputs/glossary-quality/references.json`에 기록했다. 정답은 해당 데이터셋이 제공한 것이며 AI가 새로 작성하지 않았다. 본 프로젝트에서 청취 재검수한 회의록 정답은 아니며, 제주 의회 특화 효과를 대표하지 않는다. 후보 구축에 쓴 의회 회의록과 분리돼 있다.

`runs.json`은 실제 엔진별 배열이며 각 항목에 `id`, `audioSha256`, `engine`, `model`, `text`, `elapsedSeconds`, `firstPartialMs`, `committedMs`, `peakRamMiB`, `peakVramMiB`를 기록한다. 미측정 지연·메모리는 반드시 null이다. 오디오 해시 불일치, 모델 생성 정답, 빈 정답, 중복 실행을 거부한다. 계산 지표는 raw/정규화 CER, 삽입·삭제·대체 편집 수, 숫자 토큰 개수 정확도, 중요한 용어 포함 수, RTF이다. 정규화는 NFC·소문자·문장부호/공백 제거이고 숫자를 보존한다. 숫자를 한글 수사로 변환하지 않으며 의미적 정확도 지표로 해석하면 안 된다. 편집 동률은 대체 우선이다.

모든 엔진에 같은 음원·정답을 사용한다. G0=용어 없음, G1=수동 검수한 선택 용어, G2=G1+AI 보정으로 각각 원문과 보정 결과를 따로 평가해야 한다. 후보 구축 회의의 음원은 평가셋으로 재사용하지 않는다. 전체 평가 전 기본 Whisper를 자동 교체하지 않는다.

## 실행 상태 (2026-10-01)

| 항목 | 상태 |
|---|---|
| 공식 용어 수집·출처 사전팩 | 구현 및 실제 수집 완료 (26개 미검수 후보) |
| 실제 GPU 자원 조회 | GTX 1660 Ti, VRAM 6144 MiB; 조회 당시 free 5979 MiB |
| 공개 한국어 독립 정답·음원 | FLEURS test 3개 준비 완료 |
| native Whisper 같은 음원 추론 | 실제 CUDA G0 3개 완료; native-whisper-runs.json 및 native-whisper-quality.json |
| faster-whisper large-v3-turbo 추론 | 실제 CUDA int8_float32 G0 3개 완료; faster-whisper-runs.json 및 faster-whisper-quality.json |
| Nemotron 3.5 ASR 추론 | 실제 CUDA float32 G0 3개 완료; nemotron-runs.json 및 nemotron-quality.json |
| G0/G1/G2 사전 효과·회의 특화 CER | NOT_RUN (음원 청취 검수 필요) |
| 실제 partial/committed 지연·peak RAM | NOT_RUN |
| Nemotron Torch peak allocated VRAM | 실제 측정 최대 2560.44 MiB; GPU 전체 사용량/다른 엔진 값은 미측정 |

[NVIDIA 공식 Nemotron 3.5 ASR](https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b) 모델은 실재하며 ko-KR을 지원한다. 공식 H100 처리량은 이 PC 성능 근거가 아니다. [faster-whisper 공식 저장소](https://github.com/SYSTRAN/faster-whisper)의 CUDA/cuDNN 요구사항에 맞춰 격리한 Torch 2.5.1 CUDA 12.1 런타임으로 실제 추론했다. 사용자 기본 모델과 시스템 Python 설치는 바꾸지 않았다.

## 실제 비교의 범위

32.22초의 같은 공개 음원 3개를 통째로 입력했다. native Whisper와 faster-whisper는 한국어, 용어 힌트 없음(G0), 실제 GPU 추론이다. 정규화 CER은 전체 편집 수를 전체 정답 문자 수(127자)로 나눈 값이며, RTF는 전체 추론 시간을 전체 음원 길이로 나눈 값이다. 모델 로드와 파일 디코딩 시간은 추론 시간에서 제외했다. 스트리밍 이벤트나 장시간 회의 처리 지연을 검증한 값은 아니다.

최종 소스 진입점의 실제 실행 결과는 다음과 같다. 각 엔진의 최초 표본은 워밍업을 따로 하지 않아 최초 추론 준비 비용도 포함한다.

| 엔진 | 정규화 편집 수 / 정답 문자 | CER | 추론 합계 | RTF | 숫자 토큰 일치 / 기대 |
|---|---:|---:|---:|---:|---:|
| native Whisper small-q5_1 CUDA | 7 / 127 | 5.51% | 1.740초 | 0.0540 | 8 / 8 |
| faster-whisper large-v3-turbo CUDA int8_float32 | 6 / 127 | 4.72% | 2.330초 | 0.0723 | 8 / 8 |
| Nemotron 3.5 ASR CUDA float32 | 23 / 127 | 18.11% | 2.055초 | 0.0638 | 0 / 8 |

숫자 지표와 CER에는 표기 방식 차이가 포함된다. 두 Whisper 출력은 정답의 `일만`을 `1만`으로 써 추가 숫자 토큰 1개로 집계됐다. Nemotron은 `15m`, `2011년`, `6대6`을 `십오미터`, `이천십일년`, `육대육`처럼 출력했다. 현재 평가기는 숫자와 한글 수사를 의미적으로 동등하게 정규화하지 않으므로 Nemotron의 0/8은 숫자의 의미를 전부 틀렸다는 뜻이 아니다. 중요한 제주 용어가 없는 일반 표본이므로 해당 용어 지표의 분모는 0이며 평가 완료로 보지 않는다. 3개 표본 결과만으로 기본 엔진을 교체하거나 제주 회의 품질 향상을 주장하지 않는다.

정답 및 9개 실제 출력의 해시 검증을 포함한 보고서는 `outputs/glossary-quality/actual-engine-quality.json`, 엔진별 집계는 `actual-engine-summary.json`, 실제 전체 출력은 `actual-engine-runs.json`이다. 마지막 진입점 실행 로그는 `faster-source-final.log`와 `nemotron-source-final.log`이다. Nemotron의 2.5.1 실패 로그와 Torch 2.6에서 decode 반환형을 확인한 과정도 별도 실험 로그로 보존했다. 최종 도구는 검증된 1개 문자열 리스트를 추출하고 두 런타임을 분리한다.

실험은 `outputs/glossary-quality` 아래 uv 격리 환경과 별도 `CreatorTemp/srq056-models` 모델 캐시에서 수행했다. Windows 경로 길이 제한 때문에 캐시 경로를 짧게 분리했다. 다운로드한 평가용 모델은 설치파일이나 사용자 기본 모델 디렉터리에 포함하지 않았다. 공식 모델 snapshot과 Torch/CUDA 버전은 엔진별 `*-runtime.json`에 기록했다.

## 자체 검토

수집·팩 변환·품질 지표·CLI·자료 준비·실제 추론을 파일별로 분리했다. HTML은 표준 파서, 평가 JSON은 Zod/Pydantic 경계 검증을 거친다. 예외를 숨기지 않으며 제품 원문·사용자 모델·기존 데이터에 쓰지 않는다. 참조 자료 3개 확보는 전체 회의 정확도 평가 완료를 뜻하지 않는다.
