# Stream-Record v0.6.4 CPU 배포 검증

검증일: 2026-10-04 (한국 시간). Windows x64 CPU 빌드와 한국어 small-q5_1 모델을 포함합니다. CUDA 기능과 CUDA DLL을 포함하지 않습니다. 화자분리 자료는 AVX2 CPU용 Nemotron 실행파일·모델이며 이번 시험에서 화자분리 정확도를 평가하지 않았습니다.

## 수행한 검사

- 프런트엔드 회귀 검사: stream-record 57개, UI session 49개 통과. record-controls, compact-reader, summary-display, glossary-packs와 TypeScript 검사 통과. 프런트엔드 검사는 대역을 사용하는 검사이며 실제 음성 추론과 구분합니다.
- 배포 도구 검사 27개 통과.
- 운영 기능의 Rust 네이티브 검사: 351개 통과, 실패 0개, 무시 13개. 이관본과 GitLab 소스에 모두 없는 HE-AAC 시험 음원에 의존하는 검사 1개는 명시적으로 제외했습니다. 원래 검사는 변경하지 않았습니다. 전체 검사를 모두 통과했다는 의미는 아닙니다.
- CPU 최적화 운영 빌드와 NSIS 설치파일 생성 완료. 설치파일의 완성 크기·CRC와 SHA-256을 검사했습니다.
- 설치파일을 별도 작업 폴더에 추출하고 실행파일이 빌드 EXE의 Tauri NSIS 표식 변경 외에는 동일함을 확인했습니다. 모델·ONNX DLL·FFmpeg·llama-helper·화자분리 자료 해시가 빌드 입력과 일치하며 CUDA DLL은 없었습니다.
- 추출한 운영 EXE를 새로운 프로필로 실행했습니다. 공개 FLEURS 한국어 시험 음원 0번(12.48초)을 GUI에서 선택해 실제 전사 1구간을 완료했습니다. 네이티브 로그에서 `compiled_backend=Cpu`, `use_gpu=false`와 동봉 모델 사용을 확인했습니다.
- 한국어 전사를 GUI에서 확인하고 TXT 및 JSON으로 내보냈습니다. 앱 재시작 후 같은 전사를 다시 표시했고, SQLite 무결성 검사와 원문·점수·시간 범위를 포함한 전후 데이터 일치를 확인했습니다.

## 파일 및 근거

설치파일: `Stream-Record-0.6.4-korean-bundled-cpu-windows-x64-setup.exe`

크기: 328,134,607 bytes. SHA-256: `8c426ee5c19f8ed72834544184b422154ae81f9f933f72ba862625e25c263db6`

동봉 Whisper 모델 SHA-256: `ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb`

`BUILD_VERIFICATION.json`은 검사와 빌드 입력, `PACKAGED_RUNTIME_QA.json`은 실제 설치파일 내용물의 실행 결과를 기록합니다. `SOURCE_MANIFEST.json`은 커밋·소스 ZIP과 빌드 작업본의 해시를 연결합니다. 텍스트 파일은 Git 속성에 따라 커밋 시 줄바꿈이 정규화됩니다.

GitLab 업로드 제한 때문에 설치파일은 `.part-000`부터 `.part-004`까지 5개로 나누어 제공합니다. 모든 조각과 `INSTALLER_PARTS.json`, `Restore-Installer.ps1`을 같은 폴더에 저장하고 복원 스크립트를 실행하세요. 조각 및 완성 설치파일의 해시를 검사합니다. 정확한 안내는 `README_INSTALL.txt`입니다. 게시 과정에서 복원 시험과 모든 공개 다운로드의 해시를 확인하며 결과는 `deployment-result.json`에 기록합니다.

## 검증 범위와 남은 항목

최종 빌드의 3시간 연속 녹음, 실제 회의 전사 정확도, 한국어 화자분리 정확도, 계정별 AI 요약·보정 연결은 미실행입니다. 공개 시험 음원의 `다리 밑`이 `다림이`로 전사되는 오류가 있어 정확도 향상이나 회의 품질 완료를 주장하지 않습니다. 이전 빌드의 장시간 녹음 결과를 이번 빌드의 결과로 대신하지 않습니다.

NSIS 설치 프로그램 자체를 실행하거나 기존 설치본을 교체하지 않았습니다. 운영 앱의 TXT·JSON 내보내기 시험에서 공개 시험 음원에 관한 새 파일 2개가 Windows 문서의 Stream-Record/Exports에 생성되었습니다. 기존 녹음·데이터베이스·설정·사용자 인증 자료는 공개 소스 및 릴리스 자산에서 제외합니다. 설치파일은 미서명입니다.
