# Stream-Record 아이콘 재생성

정본: `assets/branding/streamrecord-icon-source.png`

- SHA-256: `ad509a00e923e6a69fbbc7c26e1a08be77e72ae6fb45ab138f05a6193ba75f84`
- PNG, 192×192, RGBA, 204,800바이트. 첨부 정본의 원본 바이트를 그대로 보존했다.
- 내부의 짙은 배경, 주황색 재생·음성 도형, 회색 연결 도형 및 원래 알파 채널은 정본에 속한다. 배경 제거, 다시 그리기, 색상 변경, 크롭, 고정 용량 패딩은 하지 않는다.

## 재생성

```sh
uv run scripts/generate-app-icons.py
```

또는 Python 3.12 이상과 Pillow 12.3.0이 이미 있는 환경에서:

```sh
python scripts/generate-app-icons.py
```

스크립트는 호출 위치에 관계없이 스크립트가 속한 저장소를 사용한다. 정본 해시와 Pillow 버전을 먼저 검사하며, 불일치하면 파생 파일을 쓰기 전에 종료한다. 각 크기를 정본에서 직접 LANCZOS로 보간하므로 작은 결과를 다시 확대하지 않는다. RGBA 리샘플링 외에 이미지 내용을 수정하지 않는다.

Tauri CLI의 `icon --help`를 확인했다. 기본 생성은 여러 플랫폼 자산을 만들고 `--png`는 PNG 전용 생성이므로, 이번에는 명시된 ICO 슬롯과 기존 파일명을 정확히 유지하기 위해 Pillow로 재생성한다. 이미 존재하는 플랫폼 파일만 교체하며 새 모바일 자산을 만들지 않는다.

## 출력과 참조

전체 파일 목록·크기·SHA-256은 `assets/branding/icon-manifest.json`에 기록한다.

| 출력 | 참조/용도 |
| --- | --- |
| `app/frontend/src-tauri/icons/icon.png` | Tauri 번들 기본 PNG, 1024×1024 |
| `app/frontend/src-tauri/icons/app_icon.ico` | 실제 Tauri Windows 번들 참조 |
| `app/frontend/src-tauri/icons/icon.ico` | 기존 표준 파일명 유지, 동일 ICO |
| `app/frontend/src-tauri/icons/app_icon.icns`, `icon.icns` | 기존 macOS 번들 참조 및 별칭 유지 |
| 기존 `src-tauri/icons/*.png` | 기존 파일 크기를 유지한 파생 PNG |
| `app/frontend/public/streamrecord-icon.png` | 앱 내부 브랜드 이미지, 192×192, 정본과 동일 픽셀 |
| `app/frontend/src/app/favicon.ico` | Next.js favicon |
| `assets/branding/icon-contact-sheet.png` | 16/32/48/128px 밝은/어두운 배경 검수용 |

ICO에는 16/20/24/32/40/48/64/128/256px의 아홉 RGBA PNG 슬롯을 담는다. 모든 슬롯은 원본에서 직접 보간한다. ICNS의 기존 크기별 자산도 직접 보간한다.

192px를 초과하는 256/284/310/512/1024px 결과는 **확대 파생물**이다. 256px ICO 슬롯도 확대이며, 새로운 고해상도 원본이나 추가 세부 정보가 아니다. `icon.png`의 기존 1024px 크기는 호환을 위해 유지한다.

`src-tauri/src/tray.rs`는 `app.default_window_icon()`을 사용하므로 동일 번들 아이콘에서 트레이 아이콘을 얻는다. 실제 설정은 `src-tauri/tauri.conf.json`의 `bundle.icon`을 확인해야 한다. 설치 프로그램·제거 프로그램·바로가기·작업표시줄 아이콘은 새 Windows 빌드와 설치 후 별도 검증이 필요하다.

NSIS는 실행파일의 `bundle.icon`만 지정해도 설치·제거 프로그램 아이콘을 자동으로 공유하지 않는다. `bundle.windows.nsis.installerIcon`과 `uninstallerIcon`을 각각 `icons/app_icon.ico`로 명시한다. 설치된 Tauri CLI의 `config.schema.json`에서 두 속성을 확인했다. 생성된 `installer.nsi`의 `INSTALLERICON`·`UNINSTALLERICON` 경로와 최종 설치파일·설치된 제거 프로그램의 PE 아이콘을 별도로 확인해야 한다. 설정 수정만으로 패키지 아이콘 검증을 완료 처리하지 않는다.

## 자산 검증 범위

- 정본 바이트 해시, 모든 출력 해시, PNG 크기·RGBA, ICO 슬롯 목록, 각 슬롯의 원본 직접 보간 픽셀 일치, ICNS 디코딩, 반복 생성 해시 일치를 검사했다.
- 16/32/48/128px의 밝은/어두운 배경 검수 이미지를 직접 확인했다. 내부 배경·도형·색상과 바깥 투명도가 유지되며 새 사각형 배경이 없다.
- 원본 내부에도 반투명 픽셀이 있다. 알파를 255로 강제하지 않는다. 16px의 모서리 알파가 보간으로 1이 될 수 있으며, 이 역시 투명도를 임의 보정하지 않고 원본 직접 보간 결과와 비교한다.
- 이 문서는 자산 생성 및 파일 검증 결과다. 실행파일 리소스·NSIS·설치본·시작 메뉴·작업표시줄·실제 트레이 표시, macOS 실행은 이 자산 검증만으로 완료 처리하지 않는다.
