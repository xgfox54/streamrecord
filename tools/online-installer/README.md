# 온라인 CPU 설치 EXE

`Stream-Record-0.6.19-online-cpu-win10-win11-setup.exe` 하나를 실행하면 GitLab에서 v0.6.19 CPU 설치파일을 내려받아 검증한 뒤 자동 설치하고 앱 실행을 요청합니다. 기존 녹음·모델·설정은 삭제하지 않습니다. 실행 중인 Stream-Record가 있으면 먼저 종료하도록 안내합니다.

Windows 10/11 64비트와 .NET Framework 4.8을 대상으로 합니다. Windows 10 22H2를 권장합니다. GitLab 서버의 TLS 1.3 연결은 EXE에 포함한 Rustls 다운로드 모듈이 처리하며 Windows SChannel의 TLS 버전에 의존하지 않습니다. Windows 인증서 저장소를 통해 서버 인증서를 검증합니다. Windows 보안·인증서 설정은 변경하지 않습니다. 다운로드 모듈은 C 런타임을 정적 링크하여 별도 Visual C++ 런타임 설치가 필요 없습니다.

이번 검증 PC는 Windows 11입니다. Windows 10 실기기·가상 머신 실행은 미검증입니다. 앱 본체는 실제 NSIS 마법사로 기존 설치본을 v0.6.19로 교체해 확인합니다. 온라인 설치기의 자동 설치 인수와 실패 처리는 실제 테스트 자식 EXE로 검사하며, 실제 GitLab 다운로드·복원·해시는 별도 검증합니다. 앱 본체와 온라인 설치기의 배포 대상은 CPU v0.6.19입니다. 상세 결과는 배포 파일의 UI_QA.json과 ONLINE_INSTALLER_VERIFICATION.json을 확인하세요. 앱 상단과 설정에 실제 버전을 표시하며, TXT 저장 폴더 열기는 문서 / Stream-Record / Exports를 엽니다.

EXE에 고정한 공개 HTTPS 주소·조각별 크기와 SHA-256·최종 SHA-256만 사용하며, 서버에서 받은 명령이나 인증 토큰을 실행파일에 포함하지 않습니다. 최신 버전을 임의로 고르지 않으며 새 배포판에는 새 온라인 설치 EXE를 빌드합니다.

다운로드 중 취소할 수 있고 실패 후 다시 시도하면 같은 실행에서 검증된 조각을 재사용합니다. 각 조각은 최대 3회 요청합니다. 인증서·해시 오류는 검증을 완화하지 않고 중단합니다. 설치가 시작된 뒤에는 설치파일을 강제 종료하지 않습니다.

다운로드는 사용자 LocalAppData/StreamRecordInstaller/<버전> 아래 실행별 폴더에 보관합니다. 앱의 데이터 폴더와 구분하며 자동 삭제하지 않습니다. 여유 공간은 약 1.2 GB 이상을 권장합니다. 설치파일과 온라인 설치 EXE는 미서명입니다.

빌드에는 Rust/MSVC 빌드 도구와 Windows .NET Framework C# 컴파일러가 필요합니다. `downloader` 폴더에서 `cargo build --locked --release`로 다운로드 모듈을 빌드합니다. 이 폴더의 `.cargo/config.toml`이 x64 C 런타임 정적 링크를 지정합니다. Windows x64로 빌드한 `streamrecord-download.exe`와 동봉 라이선스 원문을 아래처럼 전달합니다.

```powershell
./build.ps1 -OutputDirectory <출력폴더> -DownloaderPath <streamrecord-download.exe> -NoticesPath ./downloader/THIRD_PARTY_NOTICES.txt
```

Cargo.lock으로 다운로드 모듈 의존성을 고정합니다. 온라인 설치 EXE에는 다운로드 모듈·해시·라이선스가 포함됩니다. 모듈을 실행하기 전에 크기와 SHA-256을 검사하고 파일 쓰기를 잠급니다. 설치기의 ‘오픈소스 라이선스’ 링크에서 라이선스를 열람할 수 있습니다.

검증 옵션:

- `--verify-only`: 실제 다운로드·복원·해시 검증 UI를 실행하고 설치 실행은 생략합니다.
- `--installer-ui`: 검증한 실제 NSIS 설치 마법사를 표시합니다. 정상 실행의 자동 설치와 구분하는 QA 옵션입니다.
- `--after-app-exit`: 앱 안의 업데이트 버튼이 사용합니다. Stream-Record가 저장하고 종료하기를 최대 2분 기다린 뒤 설치하고, 설치가 끝나면 창을 닫습니다.
- `--headless-verify`: 다운로드·복원 검사를 수행하고 종료 코드 0/1을 반환합니다. 임시 작업 폴더에 VERIFIED.txt를 남깁니다.

컴파일 시 C# 경고도 오류로 처리합니다. Tests.cs는 변조·잘린 파일 거부, 취소, 오프라인 복원, 손상된 기존 파일 보존, 실제 자식 EXE에 `/S /R` 전달, 설치 실패 종료 코드 전파를 검사합니다. 새 모듈의 출력 전달·실패·과대 출력 거부·취소 시 자식 종료·변조된 모듈 거부도 검사합니다. Rust 테스트는 고정한 버전과 조각 이름만 허용하는지 검사합니다. FixtureInstaller.cs는 테스트 전용이며 배포 EXE에 포함하지 않습니다.
