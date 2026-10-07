# Windows GPU 받아쓰기 빌드

Windows GPU 변형은 Whisper의 Vulkan 백엔드를 사용합니다. NVIDIA, AMD, Intel GPU의 Vulkan 드라이버가 필요하며 모델과 받아쓰기 옵션은 기존 설정을 사용합니다. GPU가 없거나 드라이버 초기화가 실패하면 CPU를 사용합니다. GPU 컨텍스트 생성이 실패하면 CPU로 다시 적재합니다. 모델 자체가 손상되었으면 CPU에서도 실패하며 기존 파일을 변경하지 않습니다.

개발용 Vulkan SDK의 `Bin/glslc.exe`, `Include`, `Lib/vulkan-1.lib`를 준비하고 `VULKAN_SDK` 환경 변수에 SDK 디렉터리를 지정합니다. SDK 설치는 앱 사용자에게 필요하지 않습니다. clang-cl로 빌드할 때 `CXXFLAGS`에 `/utf-8 /EHsc`를 지정합니다. 기존 portable GGML 설정으로 AVX2 CPU 대체 경로를 유지합니다.

동봉 실행 자료를 준비한 뒤 `app/frontend`에서 실행합니다:

```powershell
npm run tauri:build:vulkan
```

`tools/tauri.gpu-release.conf.json`은 CUDA DLL을 제외하고 `binaries/vulkan`의 x64 로더와 라이선스를 설치 디렉터리에 복사합니다. `vulkan-1.dll`은 개발 도구 없이도 프로그램을 시작할 수 있도록 동봉하며 GPU 드라이버를 대신하지 않습니다. CPU 전용 배포 프로필은 별도로 유지합니다.

Windows Vulkan 명령은 `scripts/tauri-vulkan.js`를 통해 CMake 설정과 C++ 예외 처리를 준비합니다. 드라이버 없는 PC에서 네이티브 예외가 Rust 경계를 넘어 앱을 종료시키지 않도록 `.github/vulkan-cpu-fallback.cmake`가 고정 버전 whisper-rs-sys의 빌드 사본을 수정합니다. 네이티브 원본이 변경되면 빌드를 중단하여 다시 검증하도록 합니다. 이 빌드 스크립트가 CMake 패치를 변경 감지하지 않으므로 명시적인 Vulkan 빌드는 해당 패키지의 생성 캐시만 새로 준비합니다.

런타임 원본: <https://sdk.lunarg.com/sdk/download/1.4.363.0/windows/VulkanRT-X64-1.4.363.0-Components.zip>

- 원본 ZIP SHA256: `a25a927aa8b9f0371048f1861cf88ac3b9bc9b1fb332c42d897c8ab32695769a`
- x64 `vulkan-1.dll` SHA256: `e1fcfc9489beefa6a6d9d11d6c7517f6a2b7f16e0d3fb8f4103bee0210f314a3`
- 같은 ZIP의 `VulkanRT-License.txt`와 Vulkan-Loader 1.4.363.0의 Apache 2.0 전문을 함께 동봉합니다.

파일 받아쓰기의 예상 시간은 완료한 음성 길이와 실제 추론 시간을 기준으로 갱신합니다. 첫 구간이 끝나기 전에는 계산 중으로 표시하고, AI 보정에 걸리는 시간은 포함하지 않습니다. 받아쓰기 문장은 파일 전체 처리와 저장이 완료된 뒤 표시합니다. AI 보정본 TXT에는 유효한 보정본 또는 사용자 직접 수정본만 저장하며 최초 원문을 대신 저장하지 않습니다. TXT 구간 사이는 빈 줄로 구분합니다.
